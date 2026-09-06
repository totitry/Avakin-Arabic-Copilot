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
- `artifacts/api-server` — shared API service scaffold, currently retained for future server-side OCR/LLM features.

## Architecture decisions

- The first MVP is local-first: browser storage holds user-selected settings, personalities, favorites, reply history, and explicit saved sessions.
- Screen capture uses the browser's user-authorized `getDisplayMedia` flow; stopping the assistant cleans up tracks and temporary capture state.
- OCR is represented as an upgrade-ready boundary with honest manual/demo input states instead of claiming unsupported browser OCR is active.
- Suggestions always end at copy-to-clipboard; the app never types or sends messages into Avakin.

## Product

The app provides an RTL Arabic live assistant workspace, personality and dialect controls, manual and demo chat ingestion, focus and ignore controls for multiple players, conflict-aware reply modes, three distinct copyable suggestions, favorites, history, saved sessions, import/export, and privacy controls.

## User preferences

Arabic is the default interface language. The product should stay premium, responsive in a narrow side panel, and privacy-first.

## Gotchas

- Browser screen capture and clipboard behavior depend on explicit browser permissions and cannot be silently enabled.
- The app must preserve manual copy/paste as the final user-controlled action and must not add unofficial Avakin integrations.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
