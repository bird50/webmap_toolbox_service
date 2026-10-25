# ThaiWater Toolbox Service

Independent Node.js 22.14+ service. SQLite stores public photos, metadata and audit records. My Photos remains in browser IndexedDB and never calls this service. No PostgreSQL, Next.js, or sibling-project imports are required. `node:sqlite` currently emits an experimental warning on Node 22.

## Run

```bash
npm install
cp .env.example .env
# Set a random TOOLBOX_SERVICE_KEY (at least 32 characters), matching the web app.
npm run dev
# Production process:
npm start
```

Environment: `HOST` defaults to `127.0.0.1`, `PORT` to `4010`, `SQLITE_PATH` to `./data/toolbox.sqlite`. `TOOLBOX_SERVICE_KEY` is required; startup fails without a sufficiently long key. The database directory and schema are created on startup. Keep `.env` and `data/` private. Configure the web app's `TOOLBOX_SERVICE_URL` and matching key, then restart it.

## API contract

All endpoints require `Authorization: Bearer <TOOLBOX_SERVICE_KEY>`. Keep this service on a private network; the web server is the trusted authentication gateway. Do not expose the key to browsers. Publication requests additionally require `X-Toolbox-Owner` and URL-encoded `X-Toolbox-Username` supplied by the gateway after checking the session or signed guest cookie. Never forward client-supplied identity headers.

| Method/path | Input / access |
| --- | --- |
| GET /health | Service health |
| POST /shares | Authenticated gateway identity; multipart `eventName`, JSON-encoded `tags`, and 1–10 `photos` files |
| GET /public/photos | Public through gateway; required bbox, limit 1–200, optional username/eventName/tag/startDate/endDate |
| GET /shares/:id | Public through gateway; share metadata and at most 10 photos |
| GET /shares/:shareId/photos/:photoId | Public through gateway; sanitized JPEG |

Returned URLs point to the web gateway (`/api/...`, `/share/...`). A different client must resolve these against the gateway origin. Public APIs never return private photos or owner IDs. SQLite uses parameterized queries, WAL, indexes and transactions. EXIF GPS is read from image bytes; claimed client coordinates are ignored. GPS and capture dates are required for publication. Images are decoded and sanitized before any database write; invalid batches save nothing. Public photos do not expire with local My Photos. Both gateway and HTTP service cap multipart requests at 25 MiB (10 MiB per image); the HTTP service has a 30-second request timeout.

Publication is an explicit action available to guests while account-free mode is enabled. Guest signed cookies identify the publisher only and have no role in local My Photos access. With accounts enabled, the gateway checks requireUser and ACTIVE status. Publication audit is stored here in SQLite in the same transaction. The `/my-photos` endpoints have been removed. Existing private SQLite rows from the earlier implementation are left untouched and are not exposed or automatically imported into browser storage.

## Checks and operations

```bash
npm run lint
npm run build
npm test
npm audit
```

`lint` and `build` perform strict TypeScript checking; execution uses tsx and produces no committed build output. Tests create temporary SQLite files and exercise real image upload, authorization, publication, filters, batch atomicity and reopening persistence.

Back up SQLite with its online backup facility, or stop the service before copying the database together with any WAL files. Use a persistent disk, one service instance, private network/TLS, and deployment-level rate limits. Large installations should move image bytes to object storage and spatial search to a tiled database architecture.

Browser IndexedDB remains the original My Photos store. PostgreSQL public photo records are not imported automatically. They remain untouched, but old public links are not served by this service. Plan a separate data migration before switching an existing production deployment. No changes to non-photo Toolbox storage are included.

## Drawings

My Drawing stays in browser IndexedDB; this service only stores explicit public publications. `POST /drawing-shares` requires the same gateway identity as photo publication and accepts JSON `{name,drawings}` (1–100 objects, 20,000 total coordinates, 1 MiB). Drawings preserve tool, WGS84 points, text, style and box dimensions. Zod validates geometry minimums/closed rings, coordinate bounds, UUIDs, text lengths and safe colors/fonts/style ranges. Each publication generates new object IDs and writes drawing_shares/drawings/drawing_bounds plus audit atomically.

`GET /public/drawings?bbox=west,south,east,north&limit=50` returns `{drawings,hasMore}` for numeric bounding boxes intersecting the viewport, including antimeridian viewports. Numeric B-tree indexes support bounded queries (the bundled Node SQLite does not include R-tree). Maximum response is 50 objects, 20,000 points and about 1 MiB. Bounds can produce false positives for irregular geometry; large deployments should use exact spatial predicates and tiles. Public rows never expose owner IDs. Public copies do not expire and do not change when local drawings are edited.
