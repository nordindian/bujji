import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export type BrainProviderName = 'gemini' | 'ollama' | 'claude-cli';

export interface AppConfig {
  brainProvider: BrainProviderName;
  geminiApiKey: string;
  geminiModel: string;
  geminiBudgetLimitUsd: number;
  alertEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  ollamaUrl: string;
  ollamaModel: string;
  allowedChats: string[];
  webPort: number;
  maxHistoryMessages: number;
  reminderCheckSeconds: number;
  dataDir: string;
  authDir: string;
}

export function loadConfig(): AppConfig {
  const providerRaw = (process.env.BRAIN_PROVIDER ?? 'gemini').trim().toLowerCase();
  const brainProvider: BrainProviderName =
    providerRaw === 'ollama' || providerRaw === 'claude-cli' ? providerRaw : 'gemini';

  const allowedChats = (process.env.ALLOWED_CHATS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const budgetRaw = Number(process.env.GEMINI_BUDGET_LIMIT_USD ?? 1.0);
  const webPortRaw = Number(process.env.WEB_PORT ?? 3000);

  return {
    brainProvider,
    geminiApiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
    geminiModel: (process.env.GEMINI_MODEL ?? 'gemini-2.5-flash').trim(),
    geminiBudgetLimitUsd: Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 1.0,
    alertEmail: (process.env.ALERT_EMAIL ?? '').trim(),
    smtpHost: (process.env.SMTP_HOST ?? 'smtp.gmail.com').trim(),
    smtpPort: Number(process.env.SMTP_PORT ?? 587) || 587,
    smtpUser: (process.env.SMTP_USER ?? '').trim(),
    smtpPass: (process.env.SMTP_PASS ?? '').trim(),
    ollamaUrl: (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, ''),
    ollamaModel: (process.env.OLLAMA_MODEL ?? 'qwen2.5:3b').trim(),
    allowedChats,
    webPort: Number.isFinite(webPortRaw) && webPortRaw >= 0 ? webPortRaw : 3000,
    maxHistoryMessages: Math.max(4, Number(process.env.MAX_HISTORY_MESSAGES ?? 16) || 16),
    reminderCheckSeconds: Math.max(5, Number(process.env.REMINDER_CHECK_SECONDS ?? 30) || 30),
    dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
    authDir: path.resolve(process.env.AUTH_DIR ?? './auth_info'),
  };
}
