import nodemailer from 'nodemailer';
import type { AppConfig } from './config.js';
import type { JsonStore } from './store.js';
import type { UsageState } from './types.js';

// Conservative per-1M-token pricing in USD so the local guardrail triggers slightly early rather than late.
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gemini-3.8-flash': { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-3.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-3.5-flash': { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-3.5-pro': { inputPer1M: 1.25, outputPer1M: 10.0 },
  'gemini-2.5-flash': { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.0 },
};

export function estimateGeminiCostUsd(
  model: string,
  promptTokens: number,
  outputTokens: number,
): number {
  const key = Object.keys(MODEL_PRICING).find((k) => model.toLowerCase().includes(k));
  const pricing = key ? MODEL_PRICING[key] : { inputPer1M: 0.50, outputPer1M: 3.00 };
  const inputCost = (Math.max(0, promptTokens) / 1_000_000) * pricing.inputPer1M;
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

export class BudgetGuardrail {
  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly onWhatsAppAlert?: (chatJid: string, text: string) => Promise<void>,
  ) {}

  isLocked(): boolean {
    return this.store.getUsage().locked;
  }

  getUsage(): UsageState {
    return this.store.getUsage();
  }

  assertAllowed(): void {
    const usage = this.store.getUsage();
    if (usage.locked) {
      throw new Error(
        `Spend guardrail reached ($${usage.estimatedUsd.toFixed(4)} / $${usage.budgetLimitUsd.toFixed(2)}). Gemini is paused. Send /authorize in WhatsApp to add $1.00 and resume.`,
      );
    }
  }

  async recordAndCheck(
    chatJid: string,
    model: string,
    promptTokens: number,
    outputTokens: number,
  ): Promise<UsageState> {
    const cost = estimateGeminiCostUsd(model, promptTokens, outputTokens);
    const usage = await this.store.recordUsage(promptTokens, outputTokens, cost);

    if (usage.locked && !usage.alertSent) {
      await this.store.markAlertSent();
      const message = [
        `🛑 *Bujji Spend Guardrail Triggered*`,
        `Estimated Gemini spend reached *$${usage.estimatedUsd.toFixed(4)}* (limit: $${usage.budgetLimitUsd.toFixed(2)}).`,
        `All Gemini API calls are now paused.`,
        ``,
        `Reply */authorize* to raise the limit by $1.00 (or */authorize 2.00* for $2.00) and resume.`,
      ].join('\n');

      if (this.onWhatsAppAlert) {
        await this.onWhatsAppAlert(chatJid, message).catch((err) => {
          console.error('Failed to send WhatsApp guardrail alert:', err);
        });
      }

      await this.sendEmailAlert(usage).catch((err) => {
        console.error('Failed to send email guardrail alert:', err);
      });
    }

    return usage;
  }

  async sendEmailAlert(usage: UsageState): Promise<boolean> {
    if (!this.config.alertEmail || !this.config.smtpUser || !this.config.smtpPass) {
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpPort === 465,
      auth: {
        user: this.config.smtpUser,
        pass: this.config.smtpPass,
      },
    });

    await transporter.sendMail({
      from: this.config.smtpUser,
      to: this.config.alertEmail,
      subject: `Bujji Alert: Gemini spend reached $${usage.estimatedUsd.toFixed(2)} (Paused)`,
      text: [
        'Bujji Spend Guardrail Triggered',
        '',
        `Estimated spend: $${usage.estimatedUsd.toFixed(4)}`,
        `Budget limit: $${usage.budgetLimitUsd.toFixed(2)}`,
        `Total input tokens: ${usage.promptTokens}`,
        `Total output tokens: ${usage.outputTokens}`,
        '',
        'All Gemini API calls are paused until you send /authorize in WhatsApp.',
      ].join('\n'),
    });

    return true;
  }
}
