import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ChatMessage,
  Note,
  Recurrence,
  Reminder,
  Task,
  TaskPriority,
  TaskStatus,
  UsageState,
} from './types.js';

interface StoreData {
  reminders: Reminder[];
  notes: Note[];
  tasks: Task[];
  history: Record<string, ChatMessage[]>;
  flowChats: Record<string, boolean>;
  usage: UsageState;
}

function defaultUsage(budgetLimitUsd = 1.0): UsageState {
  return {
    promptTokens: 0,
    outputTokens: 0,
    estimatedUsd: 0,
    budgetLimitUsd,
    locked: false,
    alertSent: false,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export class JsonStore {
  private readonly filePath: string;
  private data: StoreData;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly defaultBudgetLimitUsd = 1.0,
  ) {
    this.filePath = path.join(dataDir, 'bujji.json');
    this.data = {
      reminders: [],
      notes: [],
      tasks: [],
      history: {},
      flowChats: {},
      usage: defaultUsage(defaultBudgetLimitUsd),
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      this.data = {
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        notes: Array.isArray(parsed.notes)
          ? parsed.notes.map((n) => ({ ...n, category: n.category || 'General' }))
          : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        history: parsed.history && typeof parsed.history === 'object' ? parsed.history : {},
        flowChats:
          parsed.flowChats && typeof parsed.flowChats === 'object' ? parsed.flowChats : {},
        usage:
          parsed.usage && typeof parsed.usage === 'object'
            ? {
                ...defaultUsage(this.defaultBudgetLimitUsd),
                ...parsed.usage,
                budgetLimitUsd: this.defaultBudgetLimitUsd,
              }
            : defaultUsage(this.defaultBudgetLimitUsd),
      };
      if (this.data.usage.estimatedUsd >= this.data.usage.budgetLimitUsd) {
        this.data.usage.locked = true;
      }
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

  // --- Notion-style Pages / Notes ---

  async saveNote(input: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
  }): Promise<Note> {
    const now = new Date().toISOString();
    const category = (input.category ?? 'General').trim() || 'General';
    const existing = this.data.notes.find(
      (n) => n.title.toLowerCase() === input.title.trim().toLowerCase(),
    );
    if (existing) {
      existing.category = input.category ? category : existing.category;
      existing.content = input.content.trim();
      existing.tags = input.tags ?? existing.tags;
      existing.updatedAt = now;
      await this.persist();
      return existing;
    }

    const note: Note = {
      id: crypto.randomUUID().slice(0, 8),
      category,
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

  listNotes(category?: string): Note[] {
    const cat = category?.trim().toLowerCase();
    return this.data.notes
      .filter((n) => !cat || n.category.toLowerCase() === cat)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  searchNotes(query: string): Note[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.listNotes();
    return this.listNotes().filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  getNoteByTitleOrId(titleOrId: string): Note | undefined {
    const q = titleOrId.trim().toLowerCase();
    return this.data.notes.find(
      (n) => n.id.toLowerCase() === q || n.title.toLowerCase() === q,
    );
  }

  // --- Notion-style Task Board ---

  async addTask(input: {
    title: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    category?: string;
    dueAt?: string;
    notes?: string;
  }): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID().slice(0, 8),
      title: input.title.trim(),
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      category: (input.category ?? 'General').trim() || 'General',
      dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.data.tasks.push(task);
    await this.persist();
    return task;
  }

  listTasks(filter?: { status?: TaskStatus; category?: string }): Task[] {
    const cat = filter?.category?.trim().toLowerCase();
    return this.data.tasks
      .filter((t) => (!filter?.status || t.status === filter.status) && (!cat || t.category.toLowerCase() === cat))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateTask(
    id: string,
    patch: { status?: TaskStatus; priority?: TaskPriority; title?: string; notes?: string },
  ): Promise<Task | null> {
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return null;
    if (patch.status) task.status = patch.status;
    if (patch.priority) task.priority = patch.priority;
    if (patch.title?.trim()) task.title = patch.title.trim();
    if (patch.notes !== undefined) task.notes = patch.notes.trim() || undefined;
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return task;
  }

  async deleteTask(id: string): Promise<boolean> {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.data.tasks.splice(idx, 1);
    await this.persist();
    return true;
  }

  // --- Wispr Flow Dictation Mode ---

  isFlowMode(chatJid: string): boolean {
    return Boolean(this.data.flowChats[chatJid]);
  }

  async setFlowMode(chatJid: string, enabled: boolean): Promise<void> {
    this.data.flowChats[chatJid] = enabled;
    await this.persist();
  }

  // --- Spend Guardrail ---

  getUsage(): UsageState {
    return { ...this.data.usage };
  }

  async recordUsage(promptTokens: number, outputTokens: number, costUsd: number): Promise<UsageState> {
    this.data.usage.promptTokens += Math.max(0, promptTokens);
    this.data.usage.outputTokens += Math.max(0, outputTokens);
    this.data.usage.estimatedUsd = Number((this.data.usage.estimatedUsd + Math.max(0, costUsd)).toFixed(6));
    this.data.usage.lastUpdatedAt = new Date().toISOString();

    if (this.data.usage.estimatedUsd >= this.data.usage.budgetLimitUsd) {
      this.data.usage.locked = true;
    }

    await this.persist();
    return this.getUsage();
  }

  async markAlertSent(): Promise<void> {
    this.data.usage.alertSent = true;
    await this.persist();
  }

  async authorizeBudget(additionalUsd = 1.0): Promise<UsageState> {
    const delta = Number.isFinite(additionalUsd) && additionalUsd > 0 ? additionalUsd : 1.0;
    this.data.usage.budgetLimitUsd = Number(
      (Math.max(this.data.usage.budgetLimitUsd, this.data.usage.estimatedUsd) + delta).toFixed(2),
    );
    this.data.usage.locked = false;
    this.data.usage.alertSent = false;
    this.data.usage.lastUpdatedAt = new Date().toISOString();
    await this.persist();
    return this.getUsage();
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
