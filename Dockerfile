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

# Install all dependencies (tsx is a devDependency needed at runtime)
COPY package*.json ./
RUN npm ci

# Copy compiled frontend assets and server source
COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY server/ ./server/
COPY tsconfig.json ./

# Create the data directory before dropping privileges
RUN mkdir -p /app/data

# Run as a non-root user
RUN addgroup -S rsea && adduser -S rsea -G rsea && chown -R rsea:rsea /app/data
USER rsea

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
