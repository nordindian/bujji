import type { AppConfig } from '../config.js';
import type { JsonStore } from '../store.js';
import { executeTool, TOOL_DEFINITIONS } from '../tools/index.js';
import type { Attachment, Brain, BrainResponse, ChatMessage, OllamaToolCall } from '../types.js';

interface OllamaChatResponse {
  message?: {
    role: 'assistant';
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  error?: string;
}

const MAX_TOOL_ROUNDS = 5;

export function buildSystemPrompt(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    'You are Bujji, a practical, concise personal assistant on WhatsApp.',
    `Current local date/time: ${now.toLocaleString()} (ISO: ${now.toISOString()}, Timezone: ${tz}).`,
    'Capabilities:',
    '- Create, list, complete, and delete reminders.',
    '- Create tap-to-add .ics calendar invites when the user asks to schedule an event or meeting.',
    '- Save and search persistent notes for tasks and business strategy brainstorming.',
    '- Brainstorm business strategy clearly with structured, actionable points.',
    'Rules:',
    '- Keep WhatsApp replies crisp and readable (use short paragraphs or bullet points).',
    '- When the user asks for a reminder or calendar event with a relative time (like "in 10 minutes" or "tomorrow at 3pm"), convert it accurately to ISO 8601 using the current date/time above before calling the tool.',
    '- Never invent tool results; call the tool first and report what actually happened.',
  ].join('\n');
}

export class OllamaBrain implements Brain {
  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
  ) {}

  async reply(chatJid: string, userMessage: string): Promise<BrainResponse> {
    const history = this.store.getHistory(chatJid);
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const attachments: Attachment[] = [];
    let finalText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.callOllama(messages);
      const msg = res.message;
      if (!msg) {
        throw new Error(res.error || 'Empty response from Ollama.');
      }

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finalText = (msg.content ?? '').trim() || 'Done.';
        break;
      }

      messages.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const result = await executeTool(call.function.name, call.function.arguments ?? {}, {
          store: this.store,
          chatJid,
        });
        if (result.attachment) {
          attachments.push(result.attachment);
        }
        messages.push({
          role: 'tool',
          content: result.output,
        });
      }
    }

    if (!finalText) {
      finalText = attachments.length > 0 ? 'Sent!' : 'Done.';
    }

    await this.store.appendHistory(
      chatJid,
      [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: finalText },
      ],
      this.config.maxHistoryMessages,
    );

    return { text: finalText, attachments };
  }

  private async callOllama(messages: ChatMessage[]): Promise<OllamaChatResponse> {
    const endpoint = `${this.config.ollamaUrl}/api/chat`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.ollamaModel,
          messages,
          tools: TOOL_DEFINITIONS,
          stream: false,
        }),
      });
    } catch (err) {
      throw new Error(
        `Could not reach Ollama at ${this.config.ollamaUrl}. Make sure Ollama is running. (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
    }

    const body = (await response.json()) as OllamaChatResponse;
    if (!response.ok) {
      const detail = body.error ?? `HTTP ${response.status}`;
      if (detail.toLowerCase().includes('not found')) {
        throw new Error(
          `Model "${this.config.ollamaModel}" is not installed in Ollama. Run: ollama pull ${this.config.ollamaModel}`,
        );
      }
      throw new Error(`Ollama error: ${detail}`);
    }

    return body;
  }
}
