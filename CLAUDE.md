# CLAUDE.md — toolbox_service

Private Node.js 22 HTTP service that stores **Public** photos and drawings in SQLite (`node:sqlite`). It is called only by a web gateway (today `../simple_gis_webapp/lib/toolbox/service.ts`) that authenticates the user and attaches the service key. Read `README.md` for the full API contract. GitHub: bird50/webmap_toolbox_service, branch `main`.

## Layout

| File | Role |
| --- | --- |
| `src/server.ts` | node:http entry: reads the body (25 MiB cap, 1 MiB for `/drawing-shares`), 30 s timeout, binds `HOST`/`PORT` |
| `src/service.ts` | `createService(sqlitePath, key)`: schema, bearer-key check (`timingSafeEqual`), all routes and SQL |
| `src/upload.ts` | multipart parsing, EXIF check, sharp re-encode to JPEG (≤2400 px, metadata stripped) |
| `src/photo-gps.ts`, `photo-share.ts`, `public-photo-query.ts`, `drawing-contract.ts` | Validation and contracts — **byte-identical copies of `../toolbox_sdk/src/core/*`** |

Routes: `GET /health`, `POST /shares`, `GET /public/photos`, `GET /shares/:id`, `GET /shares/:shareId/photos/:photoId`, `POST /drawing-shares`, `GET /public/drawings`.

## Rules

- **Trust boundary.** Every route requires `Authorization: Bearer <TOOLBOX_SERVICE_KEY>`. Owner identity comes only from gateway headers `X-Toolbox-Owner` / `X-Toolbox-Username`; never accept identity from request bodies, and never return owner IDs in public responses.
- **Keep it private.** Default bind is `127.0.0.1:4010`; do not add CORS or expose it publicly. Browser-facing concerns (sessions, CSRF/same-origin, rate limits) belong to the gateway.
- **Contract changes span three projects.** Changing a route, field or limit means updating the shared contract files here and in `../toolbox_sdk/src/core` identically, the SDK client/components, and the web gateway routes. Keep limits in sync (25 MiB / 10 photos / 1 MiB drawings / 200 photos and 50 drawings per response).
- **SQL.** Parameterized placeholders only. Multi-row writes (share + photos/drawings + bounds + audit) stay in one transaction so failed batches save nothing.
- **Images.** Coordinates and capture time come from EXIF in the bytes, never from client fields; always re-encode through sharp before storing.
- **Schema.** Tables are created at startup and there are no migrations or `user_version` yet. Any schema change needs a migration path for existing `data/toolbox.sqlite` files.
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
- No delete/moderation endpoint for public content; no pagination cursor beyond `hasMore`.
- `zod` has a pending `npm audit fix`.
