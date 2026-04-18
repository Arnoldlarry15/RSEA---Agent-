# syntax=docker/dockerfile:1

# ── Stage 1: build the Vite frontend ─────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Install production dependencies only (tsx is in dependencies, so included here)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled frontend assets and server source
COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY server/ ./server/
COPY tsconfig.json ./

# Create the data directory before dropping privileges
RUN mkdir -p /app/data

# DEPLOY-7: Declare /app/data as a volume so orchestrators know persistence is required.
# When running without docker-compose, always mount a volume here to avoid data loss.
VOLUME ["/app/data"]

# Run as a non-root user
RUN addgroup -S rsea && adduser -S rsea -G rsea && chown -R rsea:rsea /app
USER rsea

ENV NODE_ENV=production
EXPOSE 3000

# DEPLOY-3: Health check using the /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
