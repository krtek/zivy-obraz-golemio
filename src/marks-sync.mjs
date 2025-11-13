import { parseArgs } from 'node:util';
import { map, switchMap, tap } from 'rxjs/operators';
import { createBakalariClient } from './utils/bakalari.mjs';
import { createUploader } from './utils/upload.mjs';
import { formatDate } from './utils/util.mjs';

const { values, positionals } = parseArgs({
  options: {
    'bakalari-base-url': { type: 'string' },
    'bakalari-username': { type: 'string' },
    'bakalari-password': { type: 'string' },
    'import-key': { type: 'string' },
    'grades-line-prefix': { type: 'string' },
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
    'Usage: node src/marks-sync.mjs <bakalariBaseUrl> <username> <password> <importKey> [linePrefix] [updatedParam]'
  );
}

const gradesLinePrefix = resolveWithDefault('grades-line-prefix', 4, 'grades_line');
const gradesUpdatedParam = resolveWithDefault('grades-updated-param', 5, 'grades_updated');

const { fetchSubjectMarks } = createBakalariClient({
  baseUrl: bakalariBaseUrl,
  username: bakalariUsername,
  password: bakalariPassword
});

const uploadData = createUploader(importKey);

const now = new Date();
const fromDate = new Date();
fromDate.setMonth(fromDate.getMonth() - 1);

console.log(`Starting: marks sync, from ${fromDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`);

fetchSubjectMarks(fromDate, now)
  .pipe(
    map(marks => buildMarksQueryString(marks, gradesLinePrefix, gradesUpdatedParam)),
    tap(queryString => console.log(`Prepared query string: ${queryString}`)),
    switchMap(queryString => uploadData(queryString)),
    tap(response => console.log('Upload response:', response))
  )
  .subscribe({
    next: () => console.log('Marks successfully posted.'),
    error: error => console.error('Error occurred during marks sync:', error)
  });

function buildMarksQueryString(marks, linePrefix, updatedParam) {
  if (!Array.isArray(marks) || marks.length === 0) {
    return [
      `${linePrefix}_1=${encodeURIComponent('Žádné nové známky za vybrané období.')}`,
      `${updatedParam}=${encodeURIComponent(formatDate(new Date()))}`
    ].join('&');
  }

  const formatShortDate = (date) => {
    return new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric',
      month: 'numeric'
    }).format(date);
  };

  const lines = marks.map((mark, index) => {
    const line = `${mark.subjectName.trim()}: ${mark.markValue} (${formatShortDate(mark.editDate)})`;
    return `${linePrefix}_${index + 1}=${encodeURIComponent(line)}`;
  });

  // Add the last update timestamp based on the newest mark's edit date
  const newestEditDate = marks[0]?.editDate ?? new Date();
  lines.push(`${updatedParam}=${encodeURIComponent(formatDate(newestEditDate))}`);

  return lines.join('&');
}
