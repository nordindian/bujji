export type Recurrence = 'none' | 'daily' | 'weekly';

export interface Reminder {
  id: string;
  chatJid: string;
  title: string;
  dueAt: string; // ISO 8601
  recurrence: Recurrence;
  completed: boolean;
  createdAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface Attachment {
  filename: string;
  mimetype: string;
  buffer: Buffer;
  caption?: string;
}

export interface BrainResponse {
  text: string;
  attachments: Attachment[];
}

export interface Brain {
  reply(chatJid: string, userMessage: string): Promise<BrainResponse>;
}
