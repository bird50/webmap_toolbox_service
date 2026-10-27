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

Environment: `HOST` defaults to `127.0.0.1`, `PORT` to `4010`, `SQLITE_PATH` to `./data/toolbox.sqlite`, `TOOLBOX_DEFAULT_APP_ID` to `default`, `TOOLBOX_MODULES` to `photos,drawings,data-files` (see Modules). Startup needs `TOOLBOX_SERVICE_KEY` (at least 32 characters) or at least one active key created with `npm run key:create`. The database directory and schema are created on startup. Keep `.env` and `data/` private. Configure the web app's `TOOLBOX_SERVICE_URL` and matching key, then restart it.

## Modules

Each tool is a module with its own routes and tables: `photos` (`/shares…`, `/public/photos`, `/public/photo-shares`), `drawings` (`/drawing-shares…`, `/public/drawing-shares`, `/public/drawings`) and `data-files` (`/data-file-shares…`, `/public/data-files`). `TOOLBOX_MODULES` is a comma list of the modules this instance serves, for example `TOOLBOX_MODULES=photos` for an app that only publishes photos. Routes of a disabled module answer `404 {"error":"Not found"}`, and its tables are not created on a fresh database; enabling it later creates them on the next start. Unknown names stop the service at startup. `/health`, keys and audit are always available.

Schema versions are kept per module in the `schema_modules` table. Databases from 1.4 or earlier (`PRAGMA user_version` 1–4) first finish the old global migrations, then every module is recorded at version 1 with all existing rows kept, including tables of modules that are disabled; `user_version` stays 4.

## Apps and API keys

One service can serve several apps. Every key belongs to one app and carries scopes; every share belongs to the app whose key published it, and an app never reads, serves or deletes another app's shares.

| Scope | Allows |
| --- | --- |
| `read` | `GET /public/photos`, `GET /public/photo-shares`, `GET /public/drawings`, `GET /public/drawing-shares`, `GET /public/data-files`, `GET /shares/:id`, `GET /drawing-shares/:id`, photo images |
| `write` | `POST /shares`, `POST /drawing-shares`, `POST /data-file-shares`, deleting shares whose owner matches `X-Toolbox-Owner` |
| `moderate` | Deleting any share of the app (the gateway must allow this only for administrators) |

```bash
npm run key:create -- --app web-b --scopes read,write --label "Web B production"   # prints the key once
npm run key:list
npm run key:revoke -- key_1a2b3c4d5e6f                                              # effective on the next request
```

Give each app its own key per environment (dev, staging, production) and put it in that app's server-side `TOOLBOX_SERVICE_KEY`. Only a SHA-256 hash is stored. To rotate without downtime: create a new key, deploy it to the app, then revoke the old one. `TOOLBOX_SERVICE_KEY` in this service's `.env` remains a key for `TOOLBOX_DEFAULT_APP_ID` with all scopes, so existing gateways keep working; remove it once every app has a table key.

Migration 2 (1.2) adds `data_file_shares`, `data_features` and `data_feature_bounds`. Upgrading from 1.0: the first start (or key command) migrates the database (`PRAGMA user_version` 1), adds `api_keys` and stamps existing shares and audit rows with `TOOLBOX_DEFAULT_APP_ID`. Choose that value before upgrading; back up `data/` first.

## API contract

All endpoints require `Authorization: Bearer <key>` (see scopes above; `/health` accepts any valid key). Keep this service on a private network; the web server is the trusted authentication gateway. Do not expose the key to browsers. Publication requests additionally require `X-Toolbox-Owner` supplied by the gateway after checking the session or signed guest cookie, and accept URL-encoded `X-Toolbox-Username` (the app user; stored as `anonymous` when missing or empty) and `X-Toolbox-App-Name` (the app's display name, at most 100 characters; the key's app ID when missing). Every share row stores `appId` (from the key), `appName`, `owner` and `username`; POST responses and `GET /shares/:id` return `appName` and `username`. Migration v3 adds `appName` and fills older rows with their app ID. Never forward client-supplied identity headers.

| Method/path | Input / access |
| --- | --- |
| GET /health | Service health |
| POST /shares | Authenticated gateway identity; multipart `eventName`, JSON-encoded `tags`, 1–10 `photos` files and optional JSON-encoded `captions` (strings up to 500 characters in photo order; returned as `caption` by `GET /public/photos` and `GET /shares/:id`, migration v4) |
| GET /public/photo-shares | `read`; Public photo sets of the app, newest first: optional `eventName`/`username` (part), `tag` (whole), `startDate`/`endDate` (a photo taken in the range), combined with AND; `offset` 0–10,000, `limit` 1–50 (default 20); returns `{sets:[{id,eventName,tags,username,appName,createdAt,photoCount,capturedFrom,capturedTo,bbox,url}],hasMore}` |
| GET /public/photos | Public through gateway; required bbox, limit 1–200, optional username/eventName/tag/startDate/endDate |
| GET /shares/:id | Public through gateway; share metadata and at most 10 photos |
| GET /shares/:shareId/photos/:photoId | Public through gateway; sanitized JPEG |
| POST /data-file-shares | Gateway identity; JSON `{name,description,tags,data}` — one file's FeatureCollection, 1–5,000 features, 50,000 positions, 5 MiB; adds the `shareYYYY-MM-DD` tag |
| GET /public/data-files | Required bbox, limit 1–1000 (default 500), optional `search` (name, description, username) and `tag`, combined with AND; features carry `share_name`, `share_description`, `share_tags`, `share_username`, `share_id`; at most 100,000 positions / 4 MiB per response |
| POST /drawing-shares | Gateway identity; JSON `{name,tags?,drawings}` (up to 10 tags; the service adds `shareYYYY-MM-DD` first); returns `{id,count,tags,appName,username}` |
| GET /public/drawing-shares | `read`; Public drawing sets of the app, newest first: optional `name`/`username` (part), `tag` (whole), `startDate`/`endDate` (publication day, Thai time), combined with AND; `offset` 0–10,000, `limit` 1–50 (default 20); returns `{sets:[{id,name,tags,username,appName,createdAt,drawingCount,bbox}],hasMore}` (`bbox` = `[west,south,east,north]` of its drawings) |
| GET /drawing-shares/:id | `read`; one set of the app `{id,name,tags,username,appName,createdAt,drawings}`, 404 for other apps |
| GET /public/drawings | `read`; drawings intersecting a required bbox (see Drawings); kept for older clients |
| DELETE /shares/:id, DELETE /drawing-shares/:id, DELETE /data-file-shares/:id | `write` and the owner's `X-Toolbox-Owner`, or `moderate`; removes the share, its photos/drawings and bounds in one transaction and audits `*_DELETED` or `*_MODERATED` |

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

My Drawing stays in browser IndexedDB; this service only stores explicit public publications. `POST /drawing-shares` requires the same gateway identity as photo publication and accepts JSON `{name,tags,drawings}` (`tags` optional; sets from before 1.6 have none, drawings module migration v2) (1–100 objects, 20,000 total coordinates, 1 MiB). Drawings preserve tool, WGS84 points, text, style and box dimensions. Zod validates geometry minimums/closed rings, coordinate bounds, UUIDs, text lengths and safe colors/fonts/style ranges. Each publication generates new object IDs and writes drawing_shares/drawings/drawing_bounds plus audit atomically.

`GET /public/drawings?bbox=west,south,east,north&limit=50` returns `{drawings,hasMore}` for numeric bounding boxes intersecting the viewport, including antimeridian viewports. Numeric B-tree indexes support bounded queries (the bundled Node SQLite does not include R-tree). Maximum response is 50 objects, 20,000 points and about 1 MiB. Bounds can produce false positives for irregular geometry; large deployments should use exact spatial predicates and tiles. Public rows never expose owner IDs. Public copies do not expire and do not change when local drawings are edited.
