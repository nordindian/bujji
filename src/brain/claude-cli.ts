import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import type { JsonStore } from '../store.js';
import type { Brain, BrainInput, BrainResponse } from '../types.js';
import { buildSystemPrompt } from './ollama.js';

const execFileAsync = promisify(execFile);

export class ClaudeCliBrain implements Brain {
  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
  ) {}

  async reply(chatJid: string, input: BrainInput): Promise<BrainResponse> {
    if (input.audio && !input.text) {
      return {
        text: 'Voice notes require BRAIN_PROVIDER=gemini in .env.',
        attachments: [],
      };
    }

    const userMessage = (input.text ?? '').trim();
    const history = this.store.getHistory(chatJid);
    const contextLines = history
      .slice(-8)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const prompt = [
      buildSystemPrompt(),
      contextLines ? `Recent conversation:\n${contextLines}` : '',
      `USER: ${userMessage}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const { stdout } = await execFileAsync('claude', ['-p', prompt], {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const text = stdout.trim() || 'Done.';
    await this.store.appendHistory(
      chatJid,
      [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: text },
      ],
      this.config.maxHistoryMessages,
    );

    return { text, attachments: [] };
  }
}
