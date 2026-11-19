import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type { AppConfig } from './config.js';
import type { BudgetGuardrail } from './guardrail.js';
import type { JsonStore } from './store.js';
import type { Attachment, Brain, BrainInput } from './types.js';

export function normalizeJid(jid: string): string {
  const [userPart, serverPart] = jid.split('@');
  if (!userPart || !serverPart) return jid;
  const baseUser = userPart.split(':')[0];
  return `${baseUser}@${serverPart}`;
}

export function isChatAllowed(
  remoteJid: string,
  selfIds: Array<string | undefined> | string | undefined,
  allowedChats: string[],
): boolean {
  const normalizedRemote = normalizeJid(remoteJid);
  const ids = Array.isArray(selfIds) ? selfIds : [selfIds];
  if (ids.some((id) => id && normalizedRemote === normalizeJid(id))) {
    return true;
  }
  return allowedChats.some((allowed) => normalizeJid(allowed) === normalizedRemote);
}

export function extractText(msg: WAMessage): string {
  const m = normalizeMessageContent(msg.message);
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  ).trim();
}

export class WhatsAppBridge {
  private sock: WASocket | null = null;
  private readonly sentMessageIds = new Set<string>();
  private readonly recentMessages = new Map<string, any>();
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly brain: Brain,
    private readonly guardrail: BudgetGuardrail,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.sock?.end(undefined);
    this.sock = null;
  }

  private rememberSentId(id?: string | null): void {
    if (!id) return;
    this.sentMessageIds.add(id);
    if (this.sentMessageIds.size > 500) {
      const oldest = this.sentMessageIds.values().next().value;
      if (oldest) this.sentMessageIds.delete(oldest);
    }
  }

  private storeRecentMessage(id: string | null | undefined, messageContent: any): void {
    if (!id || !messageContent) return;
    this.recentMessages.set(id, messageContent);
    if (this.recentMessages.size > 500) {
      const oldest = this.recentMessages.keys().next().value;
      if (oldest) this.recentMessages.delete(oldest);
    }
  }

  async sendText(chatJid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp is not connected.');
    const sent = await this.sock.sendMessage(chatJid, { text });
    this.rememberSentId(sent?.key?.id);
    this.storeRecentMessage(sent?.key?.id, sent?.message);
  }

  async sendAttachment(chatJid: string, attachment: Attachment): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp is not connected.');
    const sent = await this.sock.sendMessage(chatJid, {
      document: attachment.buffer,
      mimetype: attachment.mimetype,
      fileName: attachment.filename,
      caption: attachment.caption,
    });
    this.rememberSentId(sent?.key?.id);
    this.storeRecentMessage(sent?.key?.id, sent?.message);
  }

  private async connect(): Promise<void> {
    // Tear down any previous socket so old listeners don't keep running after a reconnect
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('messages.upsert');
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.end(undefined);
      } catch {
        /* ignore */
      }
      this.sock = null;
    }
    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      // false so the phone keeps receiving push notifications while the bot is linked
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => {
        if (key.id && this.recentMessages.has(key.id)) {
          return this.recentMessages.get(key.id);
        }
        return undefined;
      },
    });

    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\nScan this QR code in WhatsApp -> Settings -> Linked Devices:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        const myJid = sock.user?.id ? normalizeJid(sock.user.id) : 'unknown';
        console.log(`Bujji is connected to WhatsApp as ${myJid}`);
        console.log('Send /help in "Message Yourself" (or send /setchat in a 1-person group).\n');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.error(
            'WhatsApp session logged out. Delete the auth_info folder and restart to scan a new QR code.',
          );
          return;
        }

        if (statusCode === DisconnectReason.connectionReplaced) {
          console.error(
            'WhatsApp session was REPLACED: another Bujji instance (laptop or VM) is using the same auth_info. ' +
              'Run only ONE instance per auth_info. Not reconnecting, to avoid a tug-of-war.',
          );
          return;
        }

        if (!this.stopped) {
          console.log('WhatsApp disconnected. Reconnecting in 3 seconds...');
          setTimeout(() => {
            void this.connect();
          }, 3000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        const msgId = msg.key.id;
        if (msgId && this.sentMessageIds.has(msgId)) {
          continue;
        }

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === 'status@broadcast') continue;

        const unwrapped = normalizeMessageContent(msg.message);
        const text = extractText(msg);
        const audioMsg = unwrapped?.audioMessage;

        if (!text && !audioMsg) continue;

        // Allow /setchat from the owner inside any group to reveal its JID for .env
        if (text.trim().toLowerCase() === '/setchat' && msg.key.fromMe) {
          console.log(`\n[WhatsApp] Group JID: ${remoteJid}`);
          console.log(`Add this to your .env file:\nALLOWED_CHATS=${remoteJid}\n`);
          await this.sendText(
            remoteJid,
            `To dedicate Bujji to this chat, add this line to your .env and restart:\n\nALLOWED_CHATS=${remoteJid}`,
          );
          continue;
        }

        if (!isChatAllowed(remoteJid, [sock.user?.id, sock.user?.lid], this.config.allowedChats)) {
          if (msg.key.fromMe) {
            console.log(
              `[WhatsApp] Ignored fromMe message in ${remoteJid}. Send /setchat there or add to ALLOWED_CHATS in .env.`,
            );
          }
          continue;
        }

        let input: BrainInput = {
          text: text || undefined,
          flowMode: this.store.isFlowMode(remoteJid),
        };

        if (audioMsg) {
          console.log(`[WhatsApp] Received voice note (${audioMsg.seconds ?? '?'}s)`);
          try {
            const buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
            input = {
              ...input,
              audio: {
                buffer,
                mimetype: audioMsg.mimetype || 'audio/ogg',
              },
            };
          } catch (err) {
            console.error('Failed to download voice note:', err);
            await this.sendText(remoteJid, 'Could not download that voice note. Please try again.');
            continue;
          }
        } else {
          console.log(`[WhatsApp] Received: "${text.slice(0, 60)}"`);
        }

        await this.handleIncoming(remoteJid, input);
      }
    });
  }

  private async handleIncoming(chatJid: string, input: BrainInput): Promise<void> {
    const rawText = (input.text ?? '').trim();
    const cmd = rawText.toLowerCase();

    if (cmd === '/help') {
      await this.sendText(
        chatJid,
        [
          '*Bujji — Your Personal Assistant*',
          '',
          'Talk or send voice notes naturally:',
          '• "Remind me tomorrow at 9am to call the supplier"',
          '• "Schedule a strategy review on Friday at 3pm"',
          '• "Add task: Launch landing page (high priority)"',
          '• "Save a page in Business Strategy: Q1 pricing..."',
          '',
          '*Commands:*',
          '/flow — toggle Wispr Flow voice-cleanup mode',
          '/tasks — view Notion-style task board',
          '/pages — list saved pages/notes',
          '/reminders — list active reminders',
          '/usage — check Gemini spend guardrail',
          '/authorize — unlock after $1.00 guardrail',
          '/clear — reset conversation memory',
          '/setchat — get this chat ID for .env',
        ].join('\n'),
      );
      return;
    }

    if (cmd === '/flow') {
      const next = !this.store.isFlowMode(chatJid);
      await this.store.setFlowMode(chatJid, next);
      await this.sendText(
        chatJid,
        next
          ? '🎙️ *Wispr Flow mode ON.* Send voice notes or rough text and I will reply only with clean, copy-paste-ready text. Send /flow again to exit.'
          : '💬 *Wispr Flow mode OFF.* Back to normal assistant mode.',
      );
      return;
    }

    if (cmd === '/usage') {
      const u = this.guardrail.getUsage();
      await this.sendText(
        chatJid,
        [
          `*Gemini Spend Guardrail*`,
          `Estimated spend: *$${u.estimatedUsd.toFixed(4)}* / $${u.budgetLimitUsd.toFixed(2)}`,
          `Tokens: ${u.promptTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out`,
          `Status: ${u.locked ? '🛑 PAUSED (send /authorize to resume)' : '✅ Active'}`,
        ].join('\n'),
      );
      return;
    }

    if (cmd === '/authorize' || cmd.startsWith('/authorize ')) {
      const arg = rawText.slice('/authorize'.length).trim();
      const amount = arg ? Number(arg) : 1.0;
      const updated = await this.store.authorizeBudget(Number.isFinite(amount) && amount > 0 ? amount : 1.0);
      await this.sendText(
        chatJid,
        `✅ Authorized! New spend guardrail limit is *$${updated.budgetLimitUsd.toFixed(2)}* (current spend: $${updated.estimatedUsd.toFixed(4)}).`,
      );
      return;
    }

    if (cmd === '/clear') {
      await this.store.clearHistory(chatJid);
      await this.sendText(chatJid, 'Conversation memory cleared.');
      return;
    }

    if (cmd === '/reminders') {
      const reminders = this.store.listReminders(false);
      if (reminders.length === 0) {
        await this.sendText(chatJid, 'No active reminders.');
        return;
      }
      const lines = reminders.map(
        (r) =>
          `• [${r.id}] *${r.title}* — ${new Date(r.dueAt).toLocaleString()}${
            r.recurrence !== 'none' ? ` (${r.recurrence})` : ''
          }`,
      );
      await this.sendText(chatJid, `*Active Reminders:*\n${lines.join('\n')}`);
      return;
    }

    if (cmd === '/tasks') {
      const tasks = this.store.listTasks().filter((t) => t.status !== 'done');
      if (tasks.length === 0) {
        await this.sendText(chatJid, 'No open tasks.');
        return;
      }
      const lines = tasks.map(
        (t) => `• [${t.id}] (${t.status}, ${t.priority}) *${t.title}* — _${t.category}_`,
      );
      await this.sendText(chatJid, `*Open Tasks:*\n${lines.join('\n')}`);
      return;
    }

    if (cmd === '/pages' || cmd === '/notes') {
      const notes = this.store.listNotes().slice(0, 10);
      if (notes.length === 0) {
        await this.sendText(chatJid, 'No saved pages yet.');
        return;
      }
      const lines = notes.map((n) => `• [${n.category}] *${n.title}*: ${n.content.slice(0, 70)}`);
      await this.sendText(chatJid, `*Saved Pages:*\n${lines.join('\n')}`);
      return;
    }

    try {
      void this.sock?.sendPresenceUpdate('composing', chatJid).catch(() => {});
      console.log(`[Brain] Processing message (${this.config.brainProvider})...`);
      const response = await this.brain.reply(chatJid, input);
      console.log(`[Brain] Sending reply (${response.text.length} chars)...`);

      if (response.text) {
        await this.sendText(chatJid, response.text);
      }
      for (const attachment of response.attachments) {
        await this.sendAttachment(chatJid, attachment);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Error handling message:', message);
      await this.sendText(chatJid, `Sorry, I hit an error:\n${message}`);
    } finally {
      void this.sock?.sendPresenceUpdate('paused', chatJid).catch(() => {});
    }
  }
}
