# --- Build stage: install deps, build frontend + backend ---------------------
FROM node:22-slim AS build

# Native modules (better-sqlite3, nodejs-polars) may need to compile if no
# prebuilt binary matches this platform/ABI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@8.15.5

WORKDIR /app

# Copy manifests first so dependency installation is cached independently
# of source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN pnpm install --frozen-lockfile

# Copy sources and build
COPY frontend/ ./frontend/
COPY backend/ ./backend/

RUN pnpm run build

# --- Runtime stage -----------------------------------------------------------
FROM node:22-slim AS runtime

WORKDIR /app

# pnpm links packages relatively into node_modules/.pnpm, so the workspace root
# and the backend's node_modules must be copied together to stay resolvable.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/backend/dist ./backend/dist

# Frontend build output is served from the backend's static directory
COPY --from=build /app/frontend/dist ./backend/static

WORKDIR /app/backend

ENV NODE_ENV=production
# SQLite file location; override to point at a mounted volume for persistence.
ENV DATABASE_PATH=/app/backend/data.db

EXPOSE 5611

CMD ["node", "dist/index.js"]
