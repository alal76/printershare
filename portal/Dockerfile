# ── Stage 1: Build Vue frontend ────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Pull docker+compose binaries from official image ──────────────────
FROM docker:27-cli AS docker-tools

# ── Stage 3: Runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine

# Docker CLI + Compose plugin (copied from official docker:cli image)
COPY --from=docker-tools /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-tools /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

RUN apk add --no-cache curl rclone

WORKDIR /app

# Production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Built Vue SPA
COPY --from=builder /app/dist ./public

# Express backend
COPY server/ ./server/

RUN mkdir -p /app/data /scans /config

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "server/index.js"]
