import { createBrain } from './brain/index.js';
import { loadConfig } from './config.js';
import { BudgetGuardrail } from './guardrail.js';
import { ReminderScheduler } from './scheduler.js';
import { JsonStore } from './store.js';
import { startWebDashboard } from './web.js';
import { WhatsAppBridge } from './whatsapp.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new JsonStore(config.dataDir, config.geminiBudgetLimitUsd);
  await store.init();

  const modelName =
    config.brainProvider === 'gemini'
      ? config.geminiModel
      : config.brainProvider === 'ollama'
        ? config.ollamaModel
        : 'claude-cli';
  console.log(`Starting Bujji (brain: ${config.brainProvider}, model: ${modelName})...`);

  let whatsapp: WhatsAppBridge;
  const guardrail = new BudgetGuardrail(config, store, async (chatJid, text) => {
    await whatsapp.sendText(chatJid, text);
  });

  const brain = createBrain(config, store, guardrail);
  whatsapp = new WhatsAppBridge(config, store, brain, guardrail);

  const scheduler = new ReminderScheduler(
    store,
    config.reminderCheckSeconds * 1000,
    async (reminder) => {
      await whatsapp.sendText(reminder.chatJid, `⏰ *Reminder:* ${reminder.title}`);
    },
  );

  const webServer = startWebDashboard(config.webPort, store);
  await whatsapp.start();
  scheduler.start();

  const shutdown = () => {
    console.log('\nShutting down Bujji...');
    scheduler.stop();
    whatsapp.stop();
    webServer?.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
