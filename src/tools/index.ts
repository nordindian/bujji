import { buildIcsEvent } from '../ics.js';
import type { JsonStore } from '../store.js';
import type { Attachment, OllamaToolDefinition, Recurrence } from '../types.js';

export const TOOL_DEFINITIONS: OllamaToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current local date, time, day of week, and timezone.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description:
        'Create a reminder that will be sent as a WhatsApp message at the scheduled date and time.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short description of what to remind the user about.',
          },
          dueAtIso: {
            type: 'string',
            description:
              'Due date and time in ISO 8601 format with timezone offset or Z (e.g. 2026-11-17T09:00:00-08:00).',
          },
          recurrence: {
            type: 'string',
            enum: ['none', 'daily', 'weekly'],
            description: 'Optional recurrence schedule. Defaults to none.',
          },
        },
        required: ['title', 'dueAtIso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: 'List upcoming or completed reminders.',
      parameters: {
        type: 'object',
        properties: {
          includeCompleted: {
            type: 'boolean',
            description: 'Whether to include completed reminders. Defaults to false.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_reminder',
      description: 'Mark a reminder as completed by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The reminder ID.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_reminder',
      description: 'Delete a reminder permanently by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The reminder ID.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description:
        'Generate a tap-to-add .ics calendar invite file and send it in WhatsApp so the user can add it to their phone calendar.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the calendar event.',
          },
          startIso: {
            type: 'string',
            description: 'Event start date/time in ISO 8601 format.',
          },
          endIso: {
            type: 'string',
            description: 'Optional event end date/time in ISO 8601 format (defaults to +1 hour).',
          },
          location: {
            type: 'string',
            description: 'Optional meeting link or physical location.',
          },
          description: {
            type: 'string',
            description: 'Optional event notes or agenda.',
          },
        },
        required: ['title', 'startIso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_note',
      description:
        'Save or update a persistent note (great for business ideas, strategy decisions, or reference info).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short note title.' },
          content: { type: 'string', description: 'Body of the note.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional category tags.',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: 'Search saved notes by keyword or tag.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword (empty returns recent notes).' },
        },
        required: ['query'],
      },
    },
  },
];

export interface ToolExecResult {
  output: string;
  attachment?: Attachment;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: { store: JsonStore; chatJid: string },
): Promise<ToolExecResult> {
  const { store, chatJid } = context;

  try {
    switch (name) {
      case 'get_current_time': {
        const now = new Date();
        return {
          output: JSON.stringify({
            iso: now.toISOString(),
            local: now.toLocaleString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        };
      }

      case 'create_reminder': {
        const title = String(args.title ?? '').trim();
        const dueAtIso = String(args.dueAtIso ?? '').trim();
        const recurrenceRaw = String(args.recurrence ?? 'none').trim();
        const recurrence: Recurrence =
          recurrenceRaw === 'daily' || recurrenceRaw === 'weekly' ? recurrenceRaw : 'none';

        if (!title) return { output: 'Error: title is required.' };
        if (!dueAtIso || Number.isNaN(new Date(dueAtIso).getTime())) {
          return { output: `Error: invalid dueAtIso "${dueAtIso}". Use ISO 8601 format.` };
        }

        const reminder = await store.addReminder({
          chatJid,
          title,
          dueAt: dueAtIso,
          recurrence,
        });
        return { output: JSON.stringify({ created: reminder }) };
      }

      case 'list_reminders': {
        const includeCompleted = Boolean(args.includeCompleted);
        const reminders = store.listReminders(includeCompleted);
        return { output: JSON.stringify({ reminders }) };
      }

      case 'complete_reminder': {
        const id = String(args.id ?? '').trim();
        const ok = await store.completeReminder(id);
        return { output: ok ? `Completed reminder ${id}.` : `Reminder ${id} not found.` };
      }

      case 'delete_reminder': {
        const id = String(args.id ?? '').trim();
        const ok = await store.deleteReminder(id);
        return { output: ok ? `Deleted reminder ${id}.` : `Reminder ${id} not found.` };
      }

      case 'create_calendar_event': {
        const title = String(args.title ?? '').trim();
        const startIso = String(args.startIso ?? '').trim();
        if (!title) return { output: 'Error: title is required.' };
        if (!startIso) return { output: 'Error: startIso is required.' };

        const ics = buildIcsEvent({
          title,
          startIso,
          endIso: args.endIso ? String(args.endIso) : undefined,
          location: args.location ? String(args.location) : undefined,
          description: args.description ? String(args.description) : undefined,
        });

        return {
          output: JSON.stringify({
            status: 'created',
            filename: ics.filename,
            note: 'The .ics file is attached and will be sent to WhatsApp.',
          }),
          attachment: {
            filename: ics.filename,
            mimetype: 'text/calendar',
            buffer: Buffer.from(ics.content, 'utf8'),
            caption: `📅 ${title} (tap to add to calendar)`,
          },
        };
      }

      case 'save_note': {
        const title = String(args.title ?? '').trim();
        const content = String(args.content ?? '').trim();
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        if (!title || !content) return { output: 'Error: title and content are required.' };

        const note = await store.saveNote({ title, content, tags });
        return { output: JSON.stringify({ saved: note }) };
      }

      case 'search_notes': {
        const query = String(args.query ?? '');
        const notes = store.searchNotes(query).slice(0, 10);
        return { output: JSON.stringify({ notes }) };
      }

      default:
        return { output: `Error: unknown tool "${name}".` };
    }
  } catch (err) {
    return {
      output: `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
