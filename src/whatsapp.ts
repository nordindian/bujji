import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type { AppConfig } from './config.js';
import type { JsonStore } from './store.js';
import type { Attachment, Brain } from './types.js';

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
  const m = msg.message;
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
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly brain: Brain,
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

  async sendText(chatJid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp is not connected.');
    const sent = await this.sock.sendMessage(chatJid, { text });
    this.rememberSentId(sent?.key?.id);
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
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
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
        console.log('Open your "Message Yourself" chat on WhatsApp and send a message!\n');
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

        const text = extractText(msg);
        if (!text) continue;

        if (!isChatAllowed(remoteJid, [sock.user?.id, sock.user?.lid], this.config.allowedChats)) {
          if (msg.key.fromMe) {
            console.log(
              `[WhatsApp] Ignored fromMe message in ${remoteJid}. Add to ALLOWED_CHATS in .env if this is your chat.`,
            );
          }
          continue;
        }

        console.log(`[WhatsApp] Received: "${text.slice(0, 60)}"`);
        await this.handleIncoming(remoteJid, text);
      }
    });
  }

  private async handleIncoming(chatJid: string, text: string): Promise<void> {
    const cmd = text.trim().toLowerCase();

    if (cmd === '/help') {
      await this.sendText(
        chatJid,
        [
          '*Bujji — Your Personal Assistant*',
          '',
          'Just chat naturally:',
          '• "Remind me tomorrow at 9am to call the supplier"',
          '• "Schedule a strategy review on Friday at 3pm"',
          '• "Save a note: Q1 pricing idea..."',
          '• "Let\'s brainstorm pricing for my service"',
          '',
          '*Commands:*',
          '/reminders — list active reminders',
          '/notes — list saved notes',
          '/clear — reset conversation memory',
          '/help — show this message',
        ].join('\n'),
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

    if (cmd === '/notes') {
      const notes = this.store.listNotes().slice(0, 10);
      if (notes.length === 0) {
        await this.sendText(chatJid, 'No saved notes yet.');
        return;
      }
      const lines = notes.map((n) => `• *${n.title}*: ${n.content.slice(0, 80)}`);
      await this.sendText(chatJid, `*Saved Notes:*\n${lines.join('\n')}`);
      return;
    }

    try {
      await this.sock?.sendPresenceUpdate('composing', chatJid);
      const response = await this.brain.reply(chatJid, text);

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
      await this.sock?.sendPresenceUpdate('paused', chatJid).catch(() => {});
    }
  }
}
