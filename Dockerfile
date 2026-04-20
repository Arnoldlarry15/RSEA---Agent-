# syntax=docker/dockerfile:1

# ── Stage 1: compile the server and build the Vite frontend ──────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.server.json ./
RUN npm ci
COPY . .
# Compile the TypeScript server to CommonJS JavaScript (dist-server/)
# and build the React frontend (dist/).  Running both here keeps the
# production image free of TypeScript tooling and the tsx runtime dependency.
RUN npm run build:server
# Mark the server output as CommonJS so Node treats the .js files correctly
# despite the root package.json declaring "type": "module".
RUN echo '{"type":"commonjs"}' > dist-server/package.json
RUN npx vite build --mode production

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Install production dependencies only.
# tsx is now in devDependencies, so --omit=dev keeps it out of the image.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled server JS, frontend assets, and the CJS marker
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/dist ./dist

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

# DEPLOY-3: Use the liveness probe endpoint for the Docker health check.
# Kubernetes deployments should additionally configure the readiness probe
# at /api/health/ready — see k8s/deployment.yaml for the full probe config.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health/live || exit 1

CMD ["node", "dist-server/server.js"]
