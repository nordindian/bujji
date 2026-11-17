import { buildIcsEvent } from '../ics.js';
import type { JsonStore } from '../store.js';
import type {
  Attachment,
  OllamaToolDefinition,
  Recurrence,
  TaskPriority,
  TaskStatus,
} from '../types.js';

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
          id: { type: 'string', description: 'The reminder ID.' },
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
          id: { type: 'string', description: 'The reminder ID.' },
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
          title: { type: 'string', description: 'Title of the calendar event.' },
          startIso: { type: 'string', description: 'Event start date/time in ISO 8601 format.' },
          endIso: {
            type: 'string',
            description: 'Optional event end date/time in ISO 8601 format (defaults to +1 hour).',
          },
          location: { type: 'string', description: 'Optional meeting link or physical location.' },
          description: { type: 'string', description: 'Optional event notes or agenda.' },
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
        'Create or update a Notion-style page/note in the workspace (e.g. Business Strategy, Ideas, Meetings, Personal).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Page/note title.' },
          content: { type: 'string', description: 'Markdown or plain text content of the page.' },
          category: {
            type: 'string',
            description: 'Folder/category name such as Business Strategy, Ideas, Meetings, General.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags.',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pages',
      description: 'List all Notion-style pages/notes, optionally filtered by category.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category/folder filter.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: 'Search saved pages and notes by keyword, category, or tag.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword (empty returns recent notes).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_note_file',
      description:
        'Export a saved note/page as a .txt file in WhatsApp so the user can open or share it to Samsung Notes.',
      parameters: {
        type: 'object',
        properties: {
          titleOrId: { type: 'string', description: 'The note title or ID to export.' },
        },
        required: ['titleOrId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Add a task to the Notion-style task board (todo, in_progress, done).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title.' },
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'done'],
            description: 'Initial status. Defaults to todo.',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Priority level. Defaults to medium.',
          },
          category: { type: 'string', description: 'Project or category name.' },
          dueAtIso: { type: 'string', description: 'Optional due date in ISO 8601 format.' },
          notes: { type: 'string', description: 'Optional task details.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List tasks from the Notion-style task board.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'done'],
            description: 'Optional status filter.',
          },
          category: { type: 'string', description: 'Optional category/project filter.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Update a task status, priority, title, or notes by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The task ID.' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          title: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete a task by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The task ID.' },
        },
        required: ['id'],
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
        return { output: JSON.stringify({ reminders: store.listReminders(includeCompleted) }) };
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
        const category = args.category ? String(args.category).trim() : undefined;
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        if (!title || !content) return { output: 'Error: title and content are required.' };

        const note = await store.saveNote({ title, content, category, tags });
        return { output: JSON.stringify({ saved: note }) };
      }

      case 'list_pages': {
        const category = args.category ? String(args.category) : undefined;
        const notes = store.listNotes(category).map((n) => ({
          id: n.id,
          category: n.category,
          title: n.title,
          updatedAt: n.updatedAt,
        }));
        return { output: JSON.stringify({ pages: notes }) };
      }

      case 'search_notes': {
        const query = String(args.query ?? '');
        const notes = store.searchNotes(query).slice(0, 10);
        return { output: JSON.stringify({ notes }) };
      }

      case 'export_note_file': {
        const titleOrId = String(args.titleOrId ?? '').trim();
        const note = store.getNoteByTitleOrId(titleOrId);
        if (!note) return { output: `Note "${titleOrId}" not found.` };

        const slug =
          note.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'note';
        const body = `# ${note.title}\nCategory: ${note.category}\nUpdated: ${note.updatedAt}\n\n${note.content}\n`;

        return {
          output: JSON.stringify({ exported: note.title, filename: `${slug}.txt` }),
          attachment: {
            filename: `${slug}.txt`,
            mimetype: 'text/plain',
            buffer: Buffer.from(body, 'utf8'),
            caption: `📝 ${note.title} (open or share to Samsung Notes)`,
          },
        };
      }

      case 'create_task': {
        const title = String(args.title ?? '').trim();
        if (!title) return { output: 'Error: title is required.' };
        const statusRaw = String(args.status ?? 'todo');
        const status: TaskStatus =
          statusRaw === 'in_progress' || statusRaw === 'done' ? statusRaw : 'todo';
        const prioRaw = String(args.priority ?? 'medium');
        const priority: TaskPriority =
          prioRaw === 'low' || prioRaw === 'high' ? prioRaw : 'medium';

        const dueAt = args.dueAtIso ? String(args.dueAtIso) : undefined;
        if (dueAt && Number.isNaN(new Date(dueAt).getTime())) {
          return { output: `Error: invalid dueAtIso "${dueAt}".` };
        }

        const task = await store.addTask({
          title,
          status,
          priority,
          category: args.category ? String(args.category) : undefined,
          dueAt,
          notes: args.notes ? String(args.notes) : undefined,
        });
        return { output: JSON.stringify({ created: task }) };
      }

      case 'list_tasks': {
        const statusRaw = args.status ? String(args.status) : undefined;
        const status: TaskStatus | undefined =
          statusRaw === 'todo' || statusRaw === 'in_progress' || statusRaw === 'done'
            ? statusRaw
            : undefined;
        const category = args.category ? String(args.category) : undefined;
        return { output: JSON.stringify({ tasks: store.listTasks({ status, category }) }) };
      }

      case 'update_task': {
        const id = String(args.id ?? '').trim();
        if (!id) return { output: 'Error: id is required.' };
        const statusRaw = args.status ? String(args.status) : undefined;
        const status: TaskStatus | undefined =
          statusRaw === 'todo' || statusRaw === 'in_progress' || statusRaw === 'done'
            ? statusRaw
            : undefined;
        const prioRaw = args.priority ? String(args.priority) : undefined;
        const priority: TaskPriority | undefined =
          prioRaw === 'low' || prioRaw === 'medium' || prioRaw === 'high' ? prioRaw : undefined;

        const updated = await store.updateTask(id, {
          status,
          priority,
          title: args.title ? String(args.title) : undefined,
          notes: args.notes !== undefined ? String(args.notes) : undefined,
        });
        return {
          output: updated ? JSON.stringify({ updated }) : `Task ${id} not found.`,
        };
      }

      case 'delete_task': {
        const id = String(args.id ?? '').trim();
        const ok = await store.deleteTask(id);
        return { output: ok ? `Deleted task ${id}.` : `Task ${id} not found.` };
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
