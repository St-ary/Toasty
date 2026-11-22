# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f docker/Dockerfile .

# ---- Stage 1: build ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/crypto/package.json packages/crypto/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --include=dev

COPY packages/ packages/
COPY apps/ apps/

RUN npm run build:crypto \
  && npm run build -w @toasty/server \
  && npm run build -w @toasty/web

# ---- Stage 2: production dependencies only ----------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/crypto/package.json packages/crypto/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force

# ---- Stage 3: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    PORT=8787

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/crypto ./packages/crypto
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/migrations ./migrations
COPY --from=build /app/apps/server/package.json ./package.json
COPY --from=build /app/apps/web/dist ./public

USER node
EXPOSE 8787
CMD ["node", "dist/index.js"]
