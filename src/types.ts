export type Recurrence = 'none' | 'daily' | 'weekly';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

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
  category: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: string;
  dueAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageState {
  promptTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  budgetLimitUsd: number;
  locked: boolean;
  alertSent: boolean;
  lastUpdatedAt: string;
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

export interface BrainInput {
  text?: string;
  audio?: {
    buffer: Buffer;
    mimetype: string;
  };
  flowMode?: boolean;
}

export interface BrainResponse {
  text: string;
  attachments: Attachment[];
}

export interface Brain {
  reply(chatJid: string, input: BrainInput): Promise<BrainResponse>;
}
