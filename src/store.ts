import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage, Note, Recurrence, Reminder } from './types.js';

interface StoreData {
  reminders: Reminder[];
  notes: Note[];
  history: Record<string, ChatMessage[]>;
}

const DEFAULT_DATA: StoreData = {
  reminders: [],
  notes: [],
  history: {},
};

export class JsonStore {
  private readonly filePath: string;
  private data: StoreData = structuredClone(DEFAULT_DATA);
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'bujji.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      this.data = {
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        history: parsed.history && typeof parsed.history === 'object' ? parsed.history : {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.persist();
      } else {
        throw err;
      }
    }
  }

  private persist(): Promise<void> {
    const payload = JSON.stringify(this.data, null, 2);
    const tmpPath = `${this.filePath}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(tmpPath, payload, 'utf8');
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  // --- Reminders ---

  async addReminder(input: {
    chatJid: string;
    title: string;
    dueAt: string;
    recurrence?: Recurrence;
  }): Promise<Reminder> {
    const reminder: Reminder = {
      id: crypto.randomUUID().slice(0, 8),
      chatJid: input.chatJid,
      title: input.title.trim(),
      dueAt: new Date(input.dueAt).toISOString(),
      recurrence: input.recurrence ?? 'none',
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this.data.reminders.push(reminder);
    await this.persist();
    return reminder;
  }

  listReminders(includeCompleted = false): Reminder[] {
    return this.data.reminders
      .filter((r) => includeCompleted || !r.completed)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  getDueReminders(now = new Date()): Reminder[] {
    const nowMs = now.getTime();
    return this.data.reminders.filter(
      (r) => !r.completed && new Date(r.dueAt).getTime() <= nowMs,
    );
  }

  async markReminderTriggered(id: string): Promise<Reminder | null> {
    const reminder = this.data.reminders.find((r) => r.id === id);
    if (!reminder) return null;

    if (reminder.recurrence === 'daily') {
      const next = new Date(reminder.dueAt);
      next.setDate(next.getDate() + 1);
      reminder.dueAt = next.toISOString();
    } else if (reminder.recurrence === 'weekly') {
      const next = new Date(reminder.dueAt);
      next.setDate(next.getDate() + 7);
      reminder.dueAt = next.toISOString();
    } else {
      reminder.completed = true;
    }

    await this.persist();
    return reminder;
  }

  async completeReminder(id: string): Promise<boolean> {
    const reminder = this.data.reminders.find((r) => r.id === id);
    if (!reminder) return false;
    reminder.completed = true;
    await this.persist();
    return true;
  }

  async deleteReminder(id: string): Promise<boolean> {
    const idx = this.data.reminders.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.data.reminders.splice(idx, 1);
    await this.persist();
    return true;
  }

  // --- Notes ---

  async saveNote(input: {
    title: string;
    content: string;
    tags?: string[];
  }): Promise<Note> {
    const now = new Date().toISOString();
    const existing = this.data.notes.find(
      (n) => n.title.toLowerCase() === input.title.trim().toLowerCase(),
    );
    if (existing) {
      existing.content = input.content.trim();
      existing.tags = input.tags ?? existing.tags;
      existing.updatedAt = now;
      await this.persist();
      return existing;
    }

    const note: Note = {
      id: crypto.randomUUID().slice(0, 8),
      title: input.title.trim(),
      content: input.content.trim(),
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.data.notes.push(note);
    await this.persist();
    return note;
  }

  listNotes(): Note[] {
    return [...this.data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  searchNotes(query: string): Note[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.listNotes();
    return this.listNotes().filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  // --- Conversation History ---

  getHistory(chatJid: string): ChatMessage[] {
    return [...(this.data.history[chatJid] ?? [])];
  }

  async appendHistory(
    chatJid: string,
    messages: ChatMessage[],
    maxMessages: number,
  ): Promise<void> {
    const current = this.data.history[chatJid] ?? [];
    const merged = [...current, ...messages];
    this.data.history[chatJid] = merged.slice(-maxMessages);
    await this.persist();
  }

  async clearHistory(chatJid: string): Promise<void> {
    delete this.data.history[chatJid];
    await this.persist();
  }
}
