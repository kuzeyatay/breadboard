# One image for both Crumbs services. The process to run is chosen by the
# Fly config (or `docker run ... node org-store.mjs`).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY lib ./lib
COPY indexer.mjs org-store.mjs ./
# Runs as root: Fly mounts its volume at /data owned by root, and each service is alone in its own VM.
# ponytail: add an entrypoint that chowns /data and drops to `node` if the image ever shares a host.
CMD ["node", "indexer.mjs"]
