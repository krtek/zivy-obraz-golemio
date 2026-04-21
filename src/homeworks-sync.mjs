import { parseArgs } from 'node:util';
import { map, switchMap, tap } from 'rxjs/operators';
import { createBakalariClient } from './utils/bakalari.mjs';
import { log } from './utils/logger.mjs';
import { createUploader } from './utils/upload.mjs';
import { describeRelativeDay, formatDate, startOfUtcDay } from './utils/util.mjs';

const { values, positionals } = parseArgs({
  options: {
    'bakalari-base-url': { type: 'string' },
    'bakalari-username': { type: 'string' },
    'bakalari-password': { type: 'string' },
    'import-key': { type: 'string' },
    'homeworks-param': { type: 'string' },
    'homeworks-updated-param': { type: 'string' }
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
    'Usage: node src/homeworks-sync.mjs <bakalariBaseUrl> <username> <password> <importKey> [homeworksParam] [updatedParam]'
  );
}

const homeworksParam = resolveWithDefault('homeworks-param', 4, 'homeworks');
const homeworksUpdatedParam = resolveWithDefault('homeworks-updated-param', 5, 'homeworks_updated');

const { fetchHomeworks } = createBakalariClient({
  baseUrl: bakalariBaseUrl,
  username: bakalariUsername,
  password: bakalariPassword
});

const uploadData = createUploader(importKey);

const now = new Date();
const fromDate = startOfUtcDay(now);
const toDate = new Date(fromDate);
toDate.setMonth(toDate.getMonth() + 1);

log(
  `Starting: homeworks sync, from ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`
);

fetchHomeworks(fromDate, toDate)
  .pipe(
    tap(homeworks => console.log('\n' + renderHomeworksText(homeworks, now) + '\n')),
    map(homeworks => buildHomeworksQueryString(homeworks, now, homeworksParam, homeworksUpdatedParam)),
    tap(queryString => log(`Prepared query string: ${queryString}`)),
    switchMap(queryString => uploadData(queryString)),
    tap(response => log('Upload response:', response))
  )
  .subscribe({
    next: () => log('Homeworks successfully posted.'),
    error: error => console.error('Error occurred during homeworks sync:', error)
  });

function renderHomeworksText(homeworks, generatedAt) {
  if (!Array.isArray(homeworks) || homeworks.length === 0) {
    return 'Žádné nadcházející domácí úkoly.';
  }

  return homeworks
    .slice(-5)
    .map(homework => {
      const indicator = describeRelativeDay(generatedAt, homework.dueDate);
      const subject = homework.subjectName;
      const content = (homework.content || 'Bez popisu').replace(/\s+/g, ' ');
      const dueDateText = formatDate(homework.dueDate);
      return `[${indicator}] ${subject}: ${content}`;
    })
    .join('\n');
}

function buildHomeworksQueryString(homeworks, generatedAt, param, updatedParam) {
  return [
    `${param}=${encodeURIComponent(renderHomeworksText(homeworks, generatedAt))}`,
    `${updatedParam}=${encodeURIComponent(formatDate(generatedAt))}`
  ].join('&');
}

