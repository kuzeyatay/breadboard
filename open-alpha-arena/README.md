# Open Alpha Arena

<img width="3840" height="1498" alt="image" src="https://github.com/user-attachments/assets/dac4b5d1-3da7-4b54-97e5-cef226d99547" />

<img width="2882" height="1792" alt="image" src="https://github.com/user-attachments/assets/66a5283b-3761-4992-82d1-8cd01f4d518d" />

This is a project inspired by [nof1 Alpha Arena](https://nof1.ai), you can setup AI trading bot on crypto market.

DONE:
- Paper Trading
- OpenAI compatible API
- LEVERAGE
- ccxt for quotation
- Pure TypeScript stack (backend ported from Python; nodejs-polars replaces pandas)

TODO:
- real trading (actually you can implement it with ccxt by the help of AI coding tools easily)

## Star History

<a href="https://www.star-history.com/#etrobot/open-alpha-arena&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=etrobot/open-alpha-arena&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=etrobot/open-alpha-arena&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=etrobot/open-alpha-arena&type=date&legend=top-left" />
 </picture>
</a>

## Getting Started

### Tech Stack
The whole project is TypeScript — one runtime, one package manager.

| Layer | Stack |
| --- | --- |
| Frontend | React 18 + Vite + Tailwind + shadcn/ui |
| Backend | Hono + `@hono/node-server` (HTTP & WebSocket) |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Validation | Zod |
| Dataframes | nodejs-polars (factor calculations) |
| Market data | ccxt (Hyperliquid) |

### Prerequisites
- Node.js 20+ and pnpm

### Install
```bash
pnpm install
```

### Development
By default, the workspace scripts launch:
- Backend on port 5611
- Frontend on port 5621

Start both dev servers:
```bash
pnpm run dev
```
Open:
- Frontend: http://localhost:5621
- Backend WS: ws://localhost:5611/ws

Vite proxies `/api` and `/ws` to the backend on 5611, so no extra configuration
is needed. To run the backend alone:
```bash
pnpm --filter backend dev
```

### Build
```bash
pnpm run build          # frontend (Vite) + backend (tsc)
pnpm run typecheck      # backend type check only
pnpm --filter backend test   # factor regression test vs the pandas baseline
```
The compiled backend lives in `backend/dist`; run it with `node dist/index.js`.
Copy the frontend's `dist/` into `backend/static/` to have the backend serve the
SPA (the Dockerfile does this automatically).

### Configuration
| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5611` | HTTP/WebSocket port |
| `DATABASE_PATH` | `backend/data.db` | SQLite file location |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warning` \| `error` |

### Docker
```bash
docker compose up --build
```

## License
MIT


[![Powered by DartNode](https://dartnode.com/branding/DN-Open-Source-sm.png)](https://dartnode.com "Powered by DartNode - Free VPS for Open Source")
