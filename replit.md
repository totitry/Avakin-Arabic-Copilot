# Avakin Arabic Copilot

An Arabic-first, privacy-focused conversation companion for Avakin Life that prepares natural reply suggestions from visible user-authorized chat without ever sending them automatically.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/avakin-copilot/src/App.tsx` — the local-first assistant experience, routes, and browser persistence.
- `artifacts/avakin-copilot/src/index.css` — shared visual language and responsive layout styles.
- `artifacts/avakin-copilot` — deployable React/Vite web app.
- `artifacts/api-server` — server-side Gemini proxy with validated, rate-limited reply generation.

## Architecture decisions

- The first MVP is local-first: IndexedDB holds ordered full-room chat, speaker/player context, settings, personalities, immutable reply groups, favorites, and saved sessions.
- Screen capture uses the browser's user-authorized `getDisplayMedia` flow; stopping the assistant cleans up tracks and temporary capture state.
- OCR uses free client-side Tesseract.js behind an upgrade-ready boundary, and screen frames are compared locally before OCR runs.
- Gemini generation is explicitly opt-in and uses only cleaned text plus compact conversation context through the server-side `GEMINI_API_KEY`; screenshots never leave the browser and quota failures never trigger a paid fallback.
- New chat or a manual OCR correction invalidates obsolete in-flight generations. Relevant current messages are processed sequentially without replacing historical reply groups.
- Suggestions always end at copy-to-clipboard; the app never types or sends messages into Avakin.

## Product

The app provides an RTL Arabic live assistant workspace, personality and dialect controls, real OCR chat ingestion with an explicitly labeled manual fallback, focus and ignore controls for detected players, conflict-aware reply modes, Gemini-generated copyable suggestions, favorites, history, saved sessions, import/export, and privacy controls. Production starts with no chat, players, or replies until real input arrives.

## User preferences

Arabic is the default interface language. The product should stay premium, responsive in a narrow side panel, and privacy-first.

## Gotchas

- Browser screen capture and clipboard behavior depend on explicit browser permissions and cannot be silently enabled.
- Tesseract.js downloads and caches its Arabic language data on first use; if that is unavailable, manual input remains the fallback.
- The app must preserve manual copy/paste as the final user-controlled action and must not add unofficial Avakin integrations.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
