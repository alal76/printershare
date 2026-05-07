# ── Stage 1: Build Vue frontend ────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine

# Docker CLI for compose commands and log streaming
RUN apk add --no-cache docker-cli curl

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
