import crypto from 'node:crypto';

export interface CalendarEventInput {
  title: string;
  startIso: string;
  endIso?: string;
  location?: string;
  description?: string;
}

function formatIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'event'}.ics`;
}

export function buildIcsEvent(input: CalendarEventInput): {
  filename: string;
  content: string;
} {
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid startIso date: ${input.startIso}`);
  }

  const end = input.endIso ? new Date(input.endIso) : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(end.getTime())) {
    throw new Error(`Invalid endIso date: ${input.endIso}`);
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bujji//Personal Assistant//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@bujji.local`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(input.title.trim())}`,
  ];

  if (input.location?.trim()) {
    lines.push(`LOCATION:${escapeIcsText(input.location.trim())}`);
  }
  if (input.description?.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description.trim())}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR', '');

  return {
    filename: slugifyFilename(input.title),
    content: lines.join('\r\n'),
  };
}
