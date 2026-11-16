import type { JsonStore } from './store.js';
import type { Reminder } from './types.js';

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: JsonStore,
    private readonly intervalMs: number,
    private readonly onDue: (reminder: Reminder) => Promise<void>,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;

    try {
      const due = this.store.getDueReminders(now);
      for (const reminder of due) {
        try {
          await this.onDue(reminder);
          await this.store.markReminderTriggered(reminder.id);
          sent++;
        } catch (err) {
          console.error(`Failed to deliver reminder ${reminder.id}:`, err);
        }
      }
    } finally {
      this.running = false;
    }

    return sent;
  }
}
