# Crumbs services

Crumbs is Breadboard's social layer: notes anchored to passages on the web. This folder holds the two small services behind it. Everything else (sign-in, encryption, the panel and the feed) runs inside Breadboard, in `dashboard/src/lib/crumbs` and `dashboard/src/app/crumbs`.

| Service | What it does | Data |
| --- | --- | --- |
| `indexer.mjs` | Follows Jetstream for `com.breadboard.*` records, runs each public highlight through the moderation gate, and answers "what is on this page" and the feed. Also serves Breadboard handles and the OAuth client metadata. | SQLite. A cache: rebuild it with `node indexer.mjs --rebuild`. |
| `org-store.mjs` | Stores and forwards encrypted organization content: crumbs on pages, chat rooms and their messages. It never holds a key and cannot tell a chat room from a web page. | Postgres when `DATABASE_URL` is set, otherwise SQLite. This is the only copy, so use managed Postgres with backups. |

## Run locally

In a source checkout Breadboard starts both services by itself the first time Crumbs is used. To run them by hand:

```
npm install
npm run dev      # indexer on :8787, organization store on :8788
npm test
```

## Deploy

Both services use the same image. With the Fly CLI, from this folder:

```
fly launch --copy-config --config fly.indexer.toml --no-deploy
fly volumes create crumbs_index --size 1 --config fly.indexer.toml
fly deploy --config fly.indexer.toml

fly launch --copy-config --config fly.org-store.toml --no-deploy
fly secrets set DATABASE_URL=postgres://... CRUMBS_ADMIN_TOKEN=... --config fly.org-store.toml
fly deploy --config fly.org-store.toml
```

Then point Breadboard at them: set `CRUMBS_INDEXER_URL` and `CRUMBS_ORG_STORE_URL` for the dashboard, or enter the two addresses under Crumbs, Account, Servers. To show Breadboard's name, terms and privacy policy on the account server's consent screen, also set `CRUMBS_CLIENT_ID` to `<indexer address>/client-metadata.json`.

## Settings

Indexer: `PORT`, `CRUMBS_INDEXER_DB`, `CRUMBS_PUBLIC_URL` (its https address, for client metadata), `CRUMBS_HANDLE_DOMAIN` (for `name.<domain>` handles; point a wildcard DNS record at the indexer), `CRUMBS_REPORT_THRESHOLD` (default 3 people), `CRUMBS_BLOCKED_LABELS`, `CRUMBS_ADMIN_TOKEN`, `CRUMBS_ABUSE_EMAIL`, `OPENAI_API_KEY` (adds OpenAI's moderation endpoint to the built-in rules).

Organization store: `PORT`, `DATABASE_URL`, `CRUMBS_ORG_DB`, `CRUMBS_ADMIN_TOKEN`, `CRUMBS_ABUSE_EMAIL`, `CRUMBS_MAX_ORGS`, `CRUMBS_MAX_MEMBERS`.

## Moderation by hand

With `CRUMBS_ADMIN_TOKEN` set, send `Authorization: Bearer <token>`:

- `GET  <indexer>/admin/queue` lists reported and held-back highlights.
- `POST <indexer>/admin/review {"uri": "at://...", "state": "approved" | "hidden" | ""}` overrides the automatic verdict.
- `POST <org store>/admin/orgs/<id>/suspend {"suspended": true}` suspends an organization after an abuse report. Its content stays unreadable to you: only its members hold the keys.

## Records

All in the author's own AT Protocol account:

- `com.breadboard.highlight`: `{ url, title, target: { kind, quote, prefix, suffix, ... }, comment, source?, createdAt }`
- `com.breadboard.report`: `{ subject: <highlight uri>, reason, createdAt }`
- `com.breadboard.follow`: `{ subject: <did>, createdAt }`
- `com.breadboard.handle` (key `self`): `{ name, createdAt }`
- `com.breadboard.key` (key = device id): a device's public signing and agreement keys, used for organizations
