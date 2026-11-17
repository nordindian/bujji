import http from 'node:http';
import type { JsonStore } from './store.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDashboardHtml(store: JsonStore): string {
  const tasks = store.listTasks();
  const notes = store.listNotes();
  const reminders = store.listReminders(false);
  const usage = store.getUsage();

  const columns: Array<{ key: 'todo' | 'in_progress' | 'done'; label: string }> = [
    { key: 'todo', label: 'To Do' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'done', label: 'Done' },
  ];

  const taskColumnsHtml = columns
    .map((col) => {
      const items = tasks.filter((t) => t.status === col.key);
      const cards =
        items.length === 0
          ? '<p class="empty">Empty</p>'
          : items
              .map(
                (t) => `
          <div class="card">
            <div class="card-title">${escapeHtml(t.title)}</div>
            <div class="meta">
              <span class="badge ${t.priority}">${t.priority}</span>
              <span>${escapeHtml(t.category)}</span>
            </div>
          </div>`,
              )
              .join('');
      return `<div class="col"><h3>${col.label} (${items.length})</h3>${cards}</div>`;
    })
    .join('');

  const notesHtml =
    notes.length === 0
      ? '<p class="empty">No pages yet. Ask Bujji on WhatsApp to save a note!</p>'
      : notes
          .map(
            (n) => `
        <div class="card">
          <div class="meta"><span class="badge">${escapeHtml(n.category)}</span></div>
          <div class="card-title">${escapeHtml(n.title)}</div>
          <pre class="note-body">${escapeHtml(n.content)}</pre>
        </div>`,
          )
          .join('');

  const remindersHtml =
    reminders.length === 0
      ? '<p class="empty">No active reminders.</p>'
      : reminders
          .map(
            (r) => `
        <div class="card">
          <div class="card-title">⏰ ${escapeHtml(r.title)}</div>
          <div class="meta">${escapeHtml(new Date(r.dueAt).toLocaleString())} ${
            r.recurrence !== 'none' ? `(${r.recurrence})` : ''
          }</div>
        </div>`,
          )
          .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bujji Workspace</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #191919; color: #e8e8e8; }
    header { padding: 18px 24px; border-bottom: 1px solid #2d2d2d; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    h1 { margin: 0; font-size: 20px; }
    .guardrail { font-size: 13px; padding: 6px 12px; border-radius: 6px; background: ${usage.locked ? '#5a1e1e' : '#243528'}; color: #fff; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; display: grid; gap: 28px; }
    h2 { margin: 0 0 12px; font-size: 16px; color: #bdbdbd; text-transform: uppercase; letter-spacing: .04em; }
    .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .col { background: #202020; border: 1px solid #2d2d2d; border-radius: 10px; padding: 12px; }
    .col h3 { margin: 0 0 10px; font-size: 14px; color: #cfcfcf; }
    .pages { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
    .card { background: #262626; border: 1px solid #333; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
    .card-title { font-weight: 600; margin-bottom: 6px; }
    .meta { font-size: 12px; color: #9e9e9e; display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .badge { background: #333; padding: 2px 7px; border-radius: 4px; font-size: 11px; text-transform: uppercase; }
    .badge.high { background: #6b2424; color: #ffd4d4; }
    .badge.medium { background: #5a461a; color: #ffeab3; }
    .badge.low { background: #26422c; color: #c8f5d2; }
    .note-body { white-space: pre-wrap; font-family: inherit; font-size: 13px; margin: 0; color: #d4d4d4; }
    .empty { color: #777; font-size: 13px; margin: 4px 0; }
  </style>
</head>
<body>
  <header>
    <h1>📓 Bujji Workspace</h1>
    <div class="guardrail">
      Spend Guardrail: $${usage.estimatedUsd.toFixed(4)} / $${usage.budgetLimitUsd.toFixed(2)} ${usage.locked ? '• PAUSED (/authorize)' : '• Active'}
    </div>
  </header>
  <main>
    <section>
      <h2>Task Board</h2>
      <div class="board">${taskColumnsHtml}</div>
    </section>
    <section>
      <h2>Pages &amp; Notes</h2>
      <div class="pages">${notesHtml}</div>
    </section>
    <section>
      <h2>Upcoming Reminders</h2>
      <div class="pages">${remindersHtml}</div>
    </section>
  </main>
</body>
</html>`;
}

export function startWebDashboard(port: number, store: JsonStore): http.Server | null {
  if (port <= 0) return null;

  const server = http.createServer((req, res) => {
    if (req.url === '/api/workspace') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tasks: store.listTasks(),
          notes: store.listNotes(),
          reminders: store.listReminders(false),
          usage: store.getUsage(),
        }),
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboardHtml(store));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Bujji Workspace UI: http://127.0.0.1:${port}`);
  });

  return server;
}
