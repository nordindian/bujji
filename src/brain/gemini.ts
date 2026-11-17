import type { AppConfig } from '../config.js';
import type { BudgetGuardrail } from '../guardrail.js';
import type { JsonStore } from '../store.js';
import { executeTool, TOOL_DEFINITIONS } from '../tools/index.js';
import type { Attachment, Brain, BrainInput, BrainResponse } from '../types.js';
import { buildSystemPrompt } from './ollama.js';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: string } };
  thoughtSignature?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      role?: 'model';
      parts?: GeminiPart[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

const MAX_TOOL_ROUNDS = 5;

function buildFlowPrompt(): string {
  return [
    'You are in Wispr Flow Dictation Mode.',
    'Listen to the user voice note (or read their draft text).',
    'Remove filler words ("um", "uh", "like", false starts, repetitions), fix grammar and punctuation, and format it cleanly (short paragraphs or bullet points if listing items).',
    'Preserve the user’s exact meaning and tone.',
    'Reply ONLY with the polished, copy-paste-ready text—no intro, no "Here is your cleaned text:", no extra commentary.',
  ].join('\n');
}

export class GeminiBrain implements Brain {
  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly guardrail: BudgetGuardrail,
  ) {}

  async reply(chatJid: string, input: BrainInput): Promise<BrainResponse> {
    if (!this.config.geminiApiKey) {
      throw new Error(
        'GEMINI_API_KEY is missing in your .env file. Add it to C:\\Users\\LENOVO\\bujji\\.env and restart Bujji.',
      );
    }

    this.guardrail.assertAllowed();

    const userParts: GeminiPart[] = [];
    if (input.audio) {
      userParts.push({
        inlineData: {
          mimeType: input.audio.mimetype.split(';')[0] || 'audio/ogg',
          data: input.audio.buffer.toString('base64'),
        },
      });
    }

    const textPrompt =
      input.text?.trim() ||
      (input.audio
        ? input.flowMode
          ? 'Transcribe and polish this voice note.'
          : 'Listen to this voice note and respond or execute any tasks requested.'
        : '');

    if (textPrompt) {
      userParts.push({ text: textPrompt });
    }

    if (userParts.length === 0) {
      return { text: 'Send a text or voice message.', attachments: [] };
    }

    // In Flow mode, skip tool calling and history bloat—just return polished text.
    if (input.flowMode) {
      const res = await this.callGemini(
        chatJid,
        buildFlowPrompt(),
        [{ role: 'user', parts: userParts }],
        false,
      );
      const outText =
        res.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? '')
          .join('')
          .trim() || 'Could not transcribe audio.';
      return { text: outText, attachments: [] };
    }

    const history = this.store.getHistory(chatJid);
    const contents: GeminiContent[] = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    contents.push({ role: 'user', parts: userParts });

    const attachments: Attachment[] = [];
    let finalText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      this.guardrail.assertAllowed();
      const res = await this.callGemini(chatJid, buildSystemPrompt(), contents, true);
      const modelParts = res.candidates?.[0]?.content?.parts ?? [];
      if (modelParts.length === 0) {
        throw new Error(res.error?.message || 'Empty response from Gemini.');
      }

      const toolCalls = modelParts.filter((p) => p.functionCall);
      if (toolCalls.length === 0) {
        finalText = modelParts
          .map((p) => p.text ?? '')
          .join('')
          .trim();
        break;
      }

      contents.push({ role: 'model', parts: modelParts });

      const responseParts: GeminiPart[] = [];
      for (const part of toolCalls) {
        const call = part.functionCall!;
        const result = await executeTool(call.name, call.args ?? {}, {
          store: this.store,
          chatJid,
        });
        if (result.attachment) {
          attachments.push(result.attachment);
        }
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { result: result.output },
          },
        });
      }

      contents.push({ role: 'user', parts: responseParts });
    }

    if (!finalText) {
      finalText = attachments.length > 0 ? 'Sent!' : 'Done.';
    }

    const historyLabel = input.audio ? `[Voice note] ${input.text ?? ''}`.trim() : textPrompt;
    await this.store.appendHistory(
      chatJid,
      [
        { role: 'user', content: historyLabel },
        { role: 'assistant', content: finalText },
      ],
      this.config.maxHistoryMessages,
    );

    return { text: finalText, attachments };
  }

  private async callGemini(
    chatJid: string,
    systemPrompt: string,
    contents: GeminiContent[],
    enableTools: boolean,
  ): Promise<GeminiApiResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.config.geminiModel,
    )}:generateContent`;

    const payload: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
    };

    if (enableTools) {
      payload.tools = [
        {
          functionDeclarations: TOOL_DEFINITIONS.map((t) => t.function),
        },
      ];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.geminiApiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const body = (await response.json()) as GeminiApiResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `Gemini HTTP ${response.status}`);
    }

    const promptTokens = body.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
    await this.guardrail.recordAndCheck(chatJid, this.config.geminiModel, promptTokens, outputTokens);

    return body;
  }
}
