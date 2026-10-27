# CLAUDE.md — toolbox_service

Private Node.js 22 HTTP service that stores **Public** photos, drawings and data files in SQLite (`node:sqlite`). It is called only by a web gateway (today `../simple_gis_webapp/lib/toolbox/service.ts`) that authenticates the user and attaches the service key. Read `README.md` for the full API contract. GitHub: bird50/webmap_toolbox_service, branch `main`.

## Layout

| File | Role |
| --- | --- |
| `src/server.ts` | node:http entry: reads the body (25 MiB cap, 1 MiB for `/drawing-shares`), 30 s timeout, binds `HOST`/`PORT`, parses `TOOLBOX_MODULES` |
| `src/service.ts` | Core: `createService(sqlitePath, legacyKey, {defaultAppId, modules})` — bearer auth → app + scopes, `/health`, JSON/transaction/audit helpers, gateway identity `who()`, error mapping; hands each request to the enabled modules, else 404 |
| `src/modules/context.ts` | `Context` given to modules, `ToolModule` type, `MODULE_NAMES`, shared `deleteShare` (owner/moderator rule) |
| `src/modules/photos.ts`, `drawings.ts`, `data-files.ts` | One tool each: its routes, SQL and table migrations |
| `src/modules/index.ts` | Module registry and `parseModules` (zod; unknown names fail at startup) |
| `src/database.ts` | `openDatabase(path, defaultAppId, schemas)`: frozen legacy list on `PRAGMA user_version` 1–4, then per-module versions in `schema_modules` (core + enabled modules only) |
| `src/api-keys.ts`, `src/keys.ts` | Key store (SHA-256 hashes, scopes `read`/`write`/`moderate`) and the `key:create`/`key:list`/`key:revoke` CLI |
| `src/upload.ts` | multipart parsing, EXIF check, sharp re-encode to JPEG (≤2400 px, metadata stripped) |
| `src/photo-gps.ts`, `photo-share.ts`, `share-tags.ts`, `public-photo-query.ts`, `public-photo-sets.ts`, `drawing-contract.ts`, `public-drawing-sets.ts`, `data-file-share.ts`, `public-data-file-sets.ts` | Validation and contracts — **byte-identical copies of `../toolbox_sdk/src/core/*`** |

Routes (each only when its module is enabled): `GET /health`, `POST /shares`, `GET /public/photos`, `GET /public/photo-shares`, `GET /shares/:id`, `GET /shares/:shareId/photos/:photoId`, `POST /drawing-shares`, `GET /public/drawing-shares`, `GET /drawing-shares/:id`, `GET /public/drawings`, `POST /data-file-shares`, `GET /public/data-file-shares`, `GET /data-file-shares/:id`, `GET /public/data-files`, `DELETE /shares/:id`, `DELETE /drawing-shares/:id`, `DELETE /data-file-shares/:id`.

## Rules

- **Tenants.** Every key belongs to one app; every new query must filter by the caller's `appId` and every route must check a scope (`denied(...)`). Tests in `tests/api-keys.test.ts` cover isolation, scopes, deletion and migration.
- **Trust boundary.** Every route requires `Authorization: Bearer <key>` (a table key or the legacy `TOOLBOX_SERVICE_KEY`). Owner identity comes only from gateway headers `X-Toolbox-Owner` / `X-Toolbox-Username` (empty = `anonymous`) / `X-Toolbox-App-Name` (empty = app ID); never accept identity from request bodies, and never return owner IDs in public responses.
- **Keep it private.** Default bind is `127.0.0.1:4010`; do not add CORS or expose it publicly. Browser-facing concerns (sessions, CSRF/same-origin, rate limits) belong to the gateway.
- **Contract changes span three projects.** Changing a route, field or limit means updating the shared contract files here and in `../toolbox_sdk/src/core` identically, the SDK client/components, and the web gateway routes. Keep limits in sync (25 MiB / 10 photos / 1 MiB drawings / 5 MiB and 5,000 features per data file share / 200 photos, 50 drawings and 1,000 data file features per response).
- **SQL.** Parameterized placeholders only. Multi-row writes (share + photos/drawings + bounds + audit) stay in one transaction so failed batches save nothing.
- **Images.** Coordinates and capture time come from EXIF in the bytes, never from client fields; always re-encode through sharp before storing.
- **Schema.** Each module owns its tables: add a change as a new entry at the end of that module's `migrations` (core tables: `core` in `src/database.ts`); never edit or reorder an applied entry. Versions live in `schema_modules(module, version)`. The pre-1.5 global list on `PRAGMA user_version` (1–4) is frozen: such databases finish it once and are adopted with every module at version 1 (`user_version` stays 4). A module's first migration must equal its v4 tables; `tests/modules.test.ts` compares a fresh and an upgraded schema. Existing `data/toolbox.sqlite` files are migrated on start.
- **Modules.** `TOOLBOX_MODULES` (default all) picks the tools an instance serves; a disabled module answers 404 and creates no tables on a fresh database (tables of an adopted database stay untouched). A new tool is a new `src/modules/*.ts` registered in `index.ts` and `MODULE_NAMES`.
- Never commit `.env` or `data/` (both are git-ignored). `TOOLBOX_SERVICE_KEY` must be ≥32 random characters and equal the web app's value.

## Commands

```bash
npm run dev     # tsx --watch; restarts on src changes
npm start       # production process (needs tsx installed)
npm run lint    # tsc --noEmit (same as build)
npm test        # node:test against temporary SQLite files
npm audit
```

- Only one instance can listen on 4010: `EADDRINUSE` means one is already running (check with `lsof -nP -iTCP:4010 -sTCP:LISTEN`).
- The `ExperimentalWarning: SQLite` on startup is expected on Node 22.
- Test through the web gateway when behaviour matters end to end: `/gis` → Photo/Draw → Save & Share Public, then the Public layers.

## Known gaps (from review)

- `server.ts` buffers the body before the key check; a write after `writeHead` that throws can crash the process.
- `drawing_bounds.rowId` references the implicit `drawings` rowid (no foreign key); `VACUUM` could break it.
- Delete/moderation routes exist in the service but the web gateway does not expose them yet; no pagination cursor beyond `hasMore`.
- `zod` has a pending `npm audit fix`.
