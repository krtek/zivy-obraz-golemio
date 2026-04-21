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

To run a script locally, pass required args as `--flag=value`:

```bash
node src/traffic-sync.mjs \
  --stop-id="<id>" \
  --import-key="<key>" \
  --golemio-token="<token>"

node src/marks-sync.mjs \
  --bakalari-base-url="https://..." \
  --bakalari-username="<u>" \
  --bakalari-password="<p>" \
  --import-key="<key>" \
  --grades-line-prefix="grades_line" \
  --grades-updated-param="grades_updated"
```

Each script validates its own args and prints usage on missing required ones.

## Architecture

- All files are ES Modules (`.mjs`). No TypeScript, no bundler.
- Utilities use a **factory function pattern**: `createUploader(importKey)`, `createBakalariClient(config)`, etc.
- **RxJS 7** pipelines are used throughout — not raw Promises.
- Data is uploaded to Živý Obraz via HTTP POST with query-string encoding (not JSON) to `http://in.zivyobraz.eu/?import_key=<key>&<params>`.
- Each sync script is fully self-contained; there is no shared config file.

## Gotchas

- `dotenv` is listed as a dependency but **not used** — all scripts use `node:util` `parseArgs` for CLI args. If `.env` support is needed, add `import 'dotenv/config'` manually.
- `timetable-sync.mjs` has a GitHub Actions workflow but **no `npm run` shortcut** in `package.json`.
- Prettier config references `@trivago/prettier-plugin-sort-imports` options (`importOrderSeparation`, `importOrderParserPlugins`) but that plugin is **not installed** — those keys are silently ignored.
- The `npm run copy` script hardcodes a private server IP (`felix@192.168.88.63`) — personal deployment helper only.
- Bakaláři API auth uses `client_id: 'ANDR'` (Android client workaround for the unofficial API).
- The Bakaláři client defensively tries multiple field name variants (e.g., `mark?.MarkText ?? mark?.Text ?? mark?.Caption`) to handle API version differences — this is intentional.

## Prettier config (`.prettierrc`)

```
singleQuote: true
printWidth: 120
arrowParens: "avoid"
trailingComma: "none"
```

## GitHub Actions

All workflows: checkout → Node 20 → `npm ci` → `node src/<script>.mjs <args from secrets>`. Required secrets: `GOLEMIO_TOKEN`, `GOLEMIO_STOP_ID`, `ZIVY_OBRAZ_IMPORT_KEY`, `BAKALARI_BASE_URL`, `BAKALARI_USERNAME`, `BAKALARI_PASSWORD`. Concurrency is set to queue (not cancel) with a 3-minute timeout.
