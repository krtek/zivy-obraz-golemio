import { parseArgs } from 'node:util';
import { map, switchMap, tap } from 'rxjs/operators';
import { createBakalariClient } from './utils/bakalari.mjs';
import { log } from './utils/logger.mjs';
import { createUploader } from './utils/upload.mjs';
import { formatDate, startOfUtcDay } from './utils/util.mjs';

const { values, positionals } = parseArgs({
  options: {
    'bakalari-base-url': { type: 'string' },
    'bakalari-username': { type: 'string' },
    'bakalari-password': { type: 'string' },
    'import-key': { type: 'string' },
    'timetable-param': { type: 'string' },
    'timetable-updated-param': { type: 'string' },
    timezone: { type: 'string' }
  },
  allowPositionals: true
});

function resolveValue(name, index) {
  return values[name] ?? positionals[index];
}

function resolveWithDefault(name, index, fallback) {
  const candidate = resolveValue(name, index);
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : fallback;
}

const bakalariBaseUrl = resolveValue('bakalari-base-url', 0);
const bakalariUsername = resolveValue('bakalari-username', 1);
const bakalariPassword = resolveValue('bakalari-password', 2);
const importKey = resolveValue('import-key', 3);

if (!bakalariBaseUrl || !bakalariUsername || !bakalariPassword || !importKey) {
  throw new Error(
    'Usage: node src/timetable-sync.mjs <bakalariBaseUrl> <username> <password> <importKey> [timetableParam] [updatedParam]'
  );
}

const timetableParam = resolveWithDefault('timetable-param', 4, 'timetable_ascii');
const timetableUpdatedParam = resolveWithDefault('timetable-updated-param', 5, 'timetable_updated');
const timezone = resolveWithDefault('timezone', 6, 'Europe/Prague');

const { fetchTimetableForDay } = createBakalariClient({
  baseUrl: bakalariBaseUrl,
  username: bakalariUsername,
  password: bakalariPassword
});

const uploadData = createUploader(importKey);

const now = new Date();
const targetDay = resolveTargetDay(now, timezone);

log(`Starting: timetable sync for ${targetDay.toISOString().split('T')[0]} (timezone: ${timezone})`);

fetchTimetableForDay(targetDay)
  .pipe(
    tap(lessons => console.log('\n' + renderTimetableAsciiArt(lessons, now, targetDay) + '\n')),
    map(lessons => buildTimetableQueryString(lessons, now, targetDay, timetableParam, timetableUpdatedParam)),
    tap(queryString => log(`Prepared query string length: ${queryString.length}`)),
    switchMap(queryString => uploadData(queryString)),
    tap(response => log('Upload response:', response))
  )
  .subscribe({
    next: () => log('Timetable successfully posted.'),
    error: error => console.error('Error occurred during timetable sync:', error)
  });

function buildTimetableQueryString(lessons, generatedAt, targetDay, asciiParam, updatedParam) {
  const asciiArt = renderTimetableAsciiArt(lessons, generatedAt, targetDay);
  const updated = formatDate(generatedAt);

  return [`${asciiParam}=${encodeURIComponent(asciiArt)}`, `${updatedParam}=${encodeURIComponent(updated)}`].join('&');
}

function renderTimetableAsciiArt(lessons, generatedAt, targetDay) {
  const weekdayName = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'long' }).format(targetDay);
  const capitalizedWeekday = weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1);
  const header = `${capitalizedWeekday} (${formatDate(generatedAt)})`;

  if (!Array.isArray(lessons) || lessons.length === 0) {
    return [
      header,
      '+-------------------------------+',
      '| Dnes v rozvrhu nejsou hodiny. |',
      '+-------------------------------+'
    ].join('\n');
  }

  const tableHeader = '+-------+---------------------------------------------+';
  const lines = [header, tableHeader, '| čas   | předmět / skupina                           |', tableHeader];

  lessons.forEach(lesson => {
    const slot = formatLessonSlot(lesson);
    const subject = formatSubjectCell(lesson);
    const note = lesson.note ? lesson.note : lesson.removed ? 'Vyjmuto z rozvrhu' : '';
    const subjectWithNote = note ? `${subject} (${note})` : subject;

    lines.push(`| ${pad(slot, 5)} | ${pad(subjectWithNote, 43)} |`);
  });

  lines.push(tableHeader);

  return lines.join('\n');
}

function formatLessonSlot(lesson) {
  if (lesson.beginTime && lesson.endTime) {
    return lesson.beginTime.padStart(5, ' ');
  }

  const hourLabel = Number.isInteger(lesson.order) ? `${lesson.order}.` : '??';
  return hourLabel;
}

function formatSubjectCell(lesson) {
  const parts = [lesson.subjectName, lesson.group].filter(part => typeof part === 'string' && part.trim());
  if (lesson.removed) {
    parts.push('[zrušeno]');
  }
  return parts.join(' ');
}

function formatDetailsCell(lesson) {
  const details = [lesson.room, lesson.teacher].filter(value => typeof value === 'string' && value.trim());
  return details.join(' | ');
}

function pad(value, width) {
  const safeValue = typeof value === 'string' ? value : '';
  const trimmedLength = Math.max(0, width - 3);
  const sliced = safeValue.length > width ? `${safeValue.slice(0, trimmedLength)}...` : safeValue;
  return sliced.padEnd(width, ' ');
}

function resolveTargetDay(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    weekday: 'short',
    hour12: false
  }).formatToParts(now);

  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const weekday = parts.find(p => p.type === 'weekday').value;

  const base = startOfUtcDay(now);

  // On weekends, always show Monday
  if (weekday === 'Sat' || weekday === 'Sun') {
    const next = new Date(base);
    const daysUntilMonday = weekday === 'Sat' ? 2 : 1;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    return next;
  }

  // On weekdays, show tomorrow from 16:00 (skip weekend to Monday)
  if (hour < 16) return base;

  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + 1);

  const nextWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short'
  }).format(next);

  if (nextWeekday === 'Sat') {
    next.setUTCDate(next.getUTCDate() + 2);
  } else if (nextWeekday === 'Sun') {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}
