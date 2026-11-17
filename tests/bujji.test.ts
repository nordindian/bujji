import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiBrain } from '../src/brain/gemini.js';
import { OllamaBrain } from '../src/brain/ollama.js';
import type { AppConfig } from '../src/config.js';
import { BudgetGuardrail } from '../src/guardrail.js';
import { buildIcsEvent, slugifyFilename } from '../src/ics.js';
import { ReminderScheduler } from '../src/scheduler.js';
import { JsonStore } from '../src/store.js';
import { executeTool } from '../src/tools/index.js';
import { renderDashboardHtml } from '../src/web.js';
import { extractText, isChatAllowed, normalizeJid } from '../src/whatsapp.js';

function makeTestConfig(tmpDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    brainProvider: 'gemini',
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-3.8-flash',
    geminiBudgetLimitUsd: 1.0,
    alertEmail: '',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:3b',
    allowedChats: [],
    webPort: 0,
    maxHistoryMessages: 16,
    reminderCheckSeconds: 30,
    dataDir: tmpDir,
    authDir: tmpDir,
    ...overrides,
  };
}

describe('ics generator', () => {
  it('builds a valid RFC 5545 calendar event with escaped text', () => {
    const ics = buildIcsEvent({
      title: 'Strategy Sync, Q1; Review',
      startIso: '2026-11-20T15:00:00Z',
      location: 'Zoom, Link',
      description: 'Line 1\nLine 2',
    });

    expect(ics.filename).toBe('strategy-sync-q1-review.ics');
    expect(ics.content).toContain('BEGIN:VCALENDAR');
    expect(ics.content).toContain('SUMMARY:Strategy Sync\\, Q1\\; Review');
    expect(ics.content).toContain('DTSTART:20261120T150000Z');
    expect(ics.content).toContain('DTEND:20261120T160000Z');
    expect(ics.content).toContain('LOCATION:Zoom\\, Link');
    expect(ics.content).toContain('DESCRIPTION:Line 1\\nLine 2');
    expect(ics.content).toContain('END:VCALENDAR');
  });

  it('slugifies empty titles safely', () => {
    expect(slugifyFilename('!!!')).toBe('event.ics');
  });
});

describe('JsonStore, Notion Workspace & ReminderScheduler', () => {
  let tmpDir: string;
  let store: JsonStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bujji-test-'));
    store = new JsonStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('persists reminders and handles daily recurrence', async () => {
    const r = await store.addReminder({
      chatJid: '123@s.whatsapp.net',
      title: 'Standup',
      dueAt: '2026-11-16T09:00:00Z',
      recurrence: 'daily',
    });

    const due = store.getDueReminders(new Date('2026-11-16T09:01:00Z'));
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(r.id);

    const delivered: string[] = [];
    const scheduler = new ReminderScheduler(store, 60_000, async (rem) => {
      delivered.push(rem.title);
    });

    const count = await scheduler.tick(new Date('2026-11-16T09:01:00Z'));
    expect(count).toBe(1);
    expect(delivered).toEqual(['Standup']);
    expect(store.getDueReminders(new Date('2026-11-16T09:02:00Z'))).toHaveLength(0);
    expect(store.listReminders()[0].dueAt).toBe('2026-11-17T09:00:00.000Z');
  });

  it('manages Notion-style pages, tasks, and exports notes for Samsung Notes', async () => {
    await store.saveNote({
      title: 'Pricing Idea',
      category: 'Business Strategy',
      content: 'Offer a starter tier at $29/mo',
      tags: ['business', 'pricing'],
    });
    expect(store.searchNotes('starter')).toHaveLength(1);
    expect(store.listNotes('Business Strategy')).toHaveLength(1);

    const exported = await executeTool(
      'export_note_file',
      { titleOrId: 'Pricing Idea' },
      { store, chatJid: '123@s.whatsapp.net' },
    );
    expect(exported.attachment?.filename).toBe('pricing-idea.txt');

    const taskRes = await executeTool(
      'create_task',
      { title: 'Launch landing page', priority: 'high', category: 'Marketing' },
      { store, chatJid: '123@s.whatsapp.net' },
    );
    expect(taskRes.output).toContain('Launch landing page');
    expect(store.listTasks({ status: 'todo' })).toHaveLength(1);

    const html = renderDashboardHtml(store);
    expect(html).toContain('Launch landing page');
    expect(html).toContain('Pricing Idea');
  });

  it('creates .ics attachment from create_calendar_event tool', async () => {
    const res = await executeTool(
      'create_calendar_event',
      {
        title: 'Call Alex',
        startIso: '2026-11-18T14:00:00Z',
      },
      { store, chatJid: '123@s.whatsapp.net' },
    );

    expect(res.attachment).toBeDefined();
    expect(res.attachment?.filename).toBe('call-alex.ics');
    expect(res.attachment?.mimetype).toBe('text/calendar');
  });
});

describe('GeminiBrain, Voice Flow Mode & $1 Spend Guardrail', () => {
  let tmpDir: string;
  let store: JsonStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bujji-gemini-'));
    store = new JsonStore(tmpDir, 1.0);
    await store.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('handles voice notes in Wispr Flow mode and locks when $1.00 guardrail triggers', async () => {
    const alerts: string[] = [];
    const config = makeTestConfig(tmpDir);
    const guardrail = new BudgetGuardrail(config, store, async (_jid, msg) => {
      alerts.push(msg);
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Let us meet tomorrow at 3 PM to finalize the Q1 pricing.' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 100_000,
          candidatesTokenCount: 400_000, // 0.30*0.1 + 2.50*0.4 = $1.03 >= $1.00
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const brain = new GeminiBrain(config, store, guardrail);
    const res = await brain.reply('123@s.whatsapp.net', {
      audio: { buffer: Buffer.from('fake-ogg'), mimetype: 'audio/ogg; codecs=opus' },
      flowMode: true,
    });

    expect(res.text).toBe('Let us meet tomorrow at 3 PM to finalize the Q1 pricing.');
    expect(guardrail.isLocked()).toBe(true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('Spend Guardrail Triggered');

    // Subsequent call must be blocked until /authorize
    await expect(
      brain.reply('123@s.whatsapp.net', { text: 'Hello?' }),
    ).rejects.toThrow(/Spend guardrail reached/);

    // Authorizing unlocks it
    await store.authorizeBudget(1.0);
    expect(guardrail.isLocked()).toBe(false);
  });

  it('executes Gemini tool calls and returns .ics attachment', async () => {
    const config = makeTestConfig(tmpDir);
    const guardrail = new BudgetGuardrail(config, store);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'create_calendar_event',
                      args: { title: 'Demo Day', startIso: '2026-11-21T11:00:00Z' },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Created the Demo Day calendar invite!' }],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 30 },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const brain = new GeminiBrain(config, store, guardrail);
    const res = await brain.reply('123@s.whatsapp.net', { text: 'Schedule Demo Day' });

    expect(res.text).toBe('Created the Demo Day calendar invite!');
    expect(res.attachments).toHaveLength(1);
    expect(res.attachments[0].filename).toBe('demo-day.ics');
    expect(guardrail.isLocked()).toBe(false);
  });
});

describe('OllamaBrain tool loop', () => {
  let tmpDir: string;
  let store: JsonStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bujji-brain-'));
    store = new JsonStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('executes tool calls returned by Ollama and returns final reply + attachment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'create_calendar_event',
                  arguments: {
                    title: 'Investor Pitch',
                    startIso: '2026-11-20T10:00:00Z',
                  },
                },
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            role: 'assistant',
            content: 'I created the Investor Pitch invite for you.',
          },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const config = makeTestConfig(tmpDir, { brainProvider: 'ollama' });
    const brain = new OllamaBrain(config, store);
    const res = await brain.reply('123@s.whatsapp.net', { text: 'Schedule Investor Pitch' });

    expect(res.text).toBe('I created the Investor Pitch invite for you.');
    expect(res.attachments).toHaveLength(1);
    expect(res.attachments[0].filename).toBe('investor-pitch.ics');
    expect(store.getHistory('123@s.whatsapp.net')).toHaveLength(2);
  });
});

describe('WhatsApp JID filtering', () => {
  it('normalizes device suffixes and allows self-chat or LID', () => {
    expect(normalizeJid('15551234567:12@s.whatsapp.net')).toBe('15551234567@s.whatsapp.net');
    expect(isChatAllowed('15551234567@s.whatsapp.net', '15551234567:4@s.whatsapp.net', [])).toBe(
      true,
    );
    expect(
      isChatAllowed(
        '99887766554433@lid',
        ['15551234567:4@s.whatsapp.net', '99887766554433:2@lid'],
        [],
      ),
    ).toBe(true);
    expect(isChatAllowed('19998887777@s.whatsapp.net', '15551234567:4@s.whatsapp.net', [])).toBe(
      false,
    );
    expect(
      isChatAllowed('19998887777@s.whatsapp.net', '15551234567:4@s.whatsapp.net', [
        '19998887777@s.whatsapp.net',
      ]),
    ).toBe(true);
  });

  it('extracts text from ephemeralMessage wrappers', () => {
    const text = extractText({
      key: { remoteJid: '123@s.whatsapp.net' },
      message: {
        ephemeralMessage: {
          message: {
            extendedTextMessage: { text: 'Hi from disappearing chat' },
          },
        },
      },
    });
    expect(text).toBe('Hi from disappearing chat');
  });
});
