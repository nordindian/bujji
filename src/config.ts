import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export interface AppConfig {
  brainProvider: 'ollama' | 'claude-cli';
  ollamaUrl: string;
  ollamaModel: string;
  allowedChats: string[];
  maxHistoryMessages: number;
  reminderCheckSeconds: number;
  dataDir: string;
  authDir: string;
}

export function loadConfig(): AppConfig {
  const providerRaw = (process.env.BRAIN_PROVIDER ?? 'ollama').trim().toLowerCase();
  const brainProvider = providerRaw === 'claude-cli' ? 'claude-cli' : 'ollama';

  const allowedChats = (process.env.ALLOWED_CHATS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    brainProvider,
    ollamaUrl: (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, ''),
    ollamaModel: (process.env.OLLAMA_MODEL ?? 'qwen2.5:3b').trim(),
    allowedChats,
    maxHistoryMessages: Math.max(4, Number(process.env.MAX_HISTORY_MESSAGES ?? 16) || 16),
    reminderCheckSeconds: Math.max(5, Number(process.env.REMINDER_CHECK_SECONDS ?? 30) || 30),
    dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
    authDir: path.resolve(process.env.AUTH_DIR ?? './auth_info'),
  };
}
