import { parseArgs } from 'node:util';
import { from } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import axios from 'axios';
import { log } from './utils/logger.mjs';
import { createUploader } from './utils/upload.mjs';
import { formatDate } from './utils/util.mjs';

const { values, positionals } = parseArgs({
  options: {
    'bakalari-base-url': { type: 'string' },
    'bakalari-username': { type: 'string' },
    'bakalari-password': { type: 'string' },
    'import-key': { type: 'string' },
    'grades-param': { type: 'string' },
    'grades-updated-param': { type: 'string' }
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
    'Usage: node src/marks-sync.mjs <bakalariBaseUrl> <username> <password> <importKey> [gradesParam] [updatedParam]'
  );
}

const gradesParam = resolveWithDefault('grades-param', 4, 'grades');
const gradesUpdatedParam = resolveWithDefault('grades-updated-param', 5, 'grades_updated');

const uploadData = createUploader(importKey);

const now = new Date();
const fromDate = new Date();
fromDate.setMonth(fromDate.getMonth() - 1);

const baseUrl = bakalariBaseUrl.trim().replace(/\/$/, '');

log(`Starting: marks sync, from ${fromDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`);

from(fetchLatestMarks()).pipe(
  tap(marks => console.log('\n' + renderMarksText(marks, now) + '\n')),
  map(marks => buildMarksQueryString(marks, now, gradesParam, gradesUpdatedParam)),
  tap(queryString => log(`Prepared query string: ${queryString}`)),
  switchMap(queryString => uploadData(queryString)),
  tap(response => log('Upload response:', response))
).subscribe({
  next: () => log('Marks successfully posted.'),
  error: error => console.error('Error occurred during marks sync:', error)
});

async function fetchLatestMarks() {
  const body = new URLSearchParams({
    client_id: 'ANDR',
    grant_type: 'password',
    username: bakalariUsername,
    password: bakalariPassword
  });

  const loginRes = await axios.post(`${baseUrl}/api/login`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  if (!loginRes.data?.access_token) {
    throw new Error('Bakaláři login did not return an access token.');
  }

  const token = loginRes.data.access_token;

  const res = await axios.get(`${baseUrl}/api/3/marks`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      from: fromDate.toISOString().split('T')[0],
      to: now.toISOString().split('T')[0]
    }
  });

  const subjects = res.data?.Subjects ?? res.data?.subjects ?? [];

  return subjects
    .flatMap(subject => {
      const subjectName = subject?.Subject?.Abbrev?.trim() ?? subject?.Subject?.Name ?? 'Neznámý předmět';
      return (subject?.Marks ?? subject?.marks ?? []).map(mark => ({
        date: new Date(mark.MarkDate ?? mark.Date ?? mark.Created),
        subjectName,
        grade: mark.MarkText ?? mark.Text ?? mark.Caption ?? '',
        caption: mark.Caption ?? mark.Theme ?? ''
      }));
    })
    .filter(mark => mark.grade && !isNaN(mark.date.getTime()))
    .sort((a, b) => b.date - a.date)
    .slice(0, 6);
}

function formatMarkDate(date) {
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Prague' })
    .format(date)
    .replace(/\s/g, '');
}

function renderMarksText(marks, generatedAt) {
  if (!marks.length) {
    return 'Žádné nové známky za vybrané období.';
  }

  return marks.map(mark => `${formatMarkDate(mark.date)} ${mark.subjectName} (${mark.caption}): ${mark.grade}`).join('\n');
}

function buildMarksQueryString(marks, generatedAt, param, updatedParam) {
  return [
    `${param}=${encodeURIComponent(renderMarksText(marks, generatedAt))}`,
    `${updatedParam}=${encodeURIComponent(formatDate(generatedAt))}`
  ].join('&');
}
