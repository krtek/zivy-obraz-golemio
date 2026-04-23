# AGENTS.md

## What this repo is

Node.js scripts that sync data from external APIs (Golemio transit, Bakaláři school system) to the [Živý Obraz](https://zivyobraz.eu) digital display platform. Each script runs once and exits; scheduling is handled entirely by GitHub Actions cron.

## Commands

```bash
npm install        # install deps
npm ci             # install locked (CI)
npx prettier --write .  # format
```

There are **no test, lint, or typecheck scripts**. Prettier is the only dev tool.

## Local testing

Store credentials in `.env.local` (not committed). Load with `set -a && source .env.local && set +a`, then pass as named args (preferred) or positionals:

```bash
set -a && source .env.local && set +a

node src/timetable-sync.mjs --bakalari-base-url="$BAKALARI_BASE_URL" --bakalari-username="$BAKALARI_USERNAME" --bakalari-password="$BAKALARI_PASSWORD" --import-key="$IMPORT_KEY"
node src/marks-sync.mjs --bakalari-base-url="$BAKALARI_BASE_URL" --bakalari-username="$BAKALARI_USERNAME" --bakalari-password="$BAKALARI_PASSWORD" --import-key="$IMPORT_KEY"
node src/homeworks-sync.mjs --bakalari-base-url="$BAKALARI_BASE_URL" --bakalari-username="$BAKALARI_USERNAME" --bakalari-password="$BAKALARI_PASSWORD" --import-key="$IMPORT_KEY"
node src/events-sync.mjs --bakalari-base-url="$BAKALARI_BASE_URL" --bakalari-username="$BAKALARI_USERNAME" --bakalari-password="$BAKALARI_PASSWORD" --import-key="$IMPORT_KEY"
node src/traffic-sync.mjs --stop-id="$GOLEMIO_STOP_ID" --import-key="$ZIVY_OBRAZ_IMPORT_KEY" --golemio-token="$GOLEMIO_TOKEN"
node src/proverb-sync.mjs --import-key="$ZIVY_OBRAZ_IMPORT_KEY"
```

Positional order (fallback): matches the usage message printed on missing args.

## Architecture

- All files are ES Modules (`.mjs`). No TypeScript, no bundler.
- Utilities use a **factory function pattern**: `createUploader(importKey)`, `createBakalariClient(config)`, etc.
- **RxJS 7** pipelines are used throughout — not raw Promises.
- Data is uploaded to Živý Obraz via HTTP POST with query-string encoding (not JSON) to `http://in.zivyobraz.eu/?import_key=<key>&<params>`.
- Each sync script is fully self-contained; there is no shared config file.
- All sync scripts print their output locally before uploading (via `tap`).

## Bakaláři API field name quirks

The real API response shapes differ from what you might expect — verified against the live API:

- **Subjects** (`/api/3/subjects`): key is `SubjectID` (uppercase `ID`), fields are `SubjectName` / `SubjectAbbrev`. IDs have **leading spaces** (e.g. `" 2"`) — always `.trim()` before map lookup.
- **Timetable atoms** (`/api/3/timetable/actual`): lesson order is `HourId`, subject ref is `SubjectId` (lowercase `d`). Days are under `Atoms`, not `Lessons`.
- **Marks** (`/api/3/marks`): grouped by subject under `Subjects`, each with nested `Marks[]`. Mark date is `MarkDate`, value is `MarkText`, description is `Caption`.
- **Homeworks** (`/api/3/homeworks`): subject name available inline at `Subject.Name` / `Subject.Abbrev` — no separate lookup needed.
- Bakaláři auth uses `client_id: 'ANDR'` (Android client workaround for the unofficial API).

## Upload param naming conventions

| Script | Params uploaded |
|--------|----------------|
| `timetable-sync.mjs` | `timetable_ascii`, `timetable_updated` (overridable via `--timetable-param` / `--timetable-updated-param`) |
| `homeworks-sync.mjs` | `homeworks`, `homeworks_updated` (single variable, `\n`-joined) |
| `marks-sync.mjs` | `grades`, `grades_updated` (single variable, `\n`-joined, latest first) |
| `events-sync.mjs` | `events_line_1`…`events_line_N` (up to 10), `events_updated` (prefix overridable via `--events-line-prefix`) |
| `proverb-sync.mjs` | `proverb`, `proverbAuthor` |
| `traffic-sync.mjs` | departure query string built by `download-golemio.mjs` |

## Gotchas

- `dotenv` is listed as a dependency but **not used** — all scripts use `node:util` `parseArgs` for CLI args. `source .env.local` does not export vars; use `set -a && source .env.local && set +a`.
- `timetable-sync.mjs` has a GitHub Actions workflow but **no `npm run` shortcut** in `package.json` (unlike the other scripts).
- Prettier config references `@trivago/prettier-plugin-sort-imports` options but that plugin is **not installed** — those keys are silently ignored.
- The `npm run copy` script hardcodes a private server IP (`felix@192.168.88.63`) — personal deployment helper only.

## Prettier config (`.prettierrc`)

```
singleQuote: true
printWidth: 120
arrowParens: "avoid"
trailingComma: "none"
```

## GitHub Actions

All workflows: checkout → Node 20 → `npm ci` → `node src/<script>.mjs <args from secrets>`. Required secrets: `GOLEMIO_TOKEN`, `GOLEMIO_STOP_ID`, `ZIVY_OBRAZ_IMPORT_KEY`, `BAKALARI_BASE_URL`, `BAKALARI_USERNAME`, `BAKALARI_PASSWORD`. Concurrency is set to queue (not cancel) with a 3-minute timeout.
