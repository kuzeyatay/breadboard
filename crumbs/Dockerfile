# One image for both Crumbs services. The process to run is chosen by the
# Fly config (or `docker run ... node org-store.mjs`).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY lib ./lib
COPY indexer.mjs org-store.mjs ./
USER node
CMD ["node", "indexer.mjs"]
