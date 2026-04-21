# RSEA Agent

A modular, autonomous AI agent framework following the **Research, Scan, Execute, Act (RSEA)** architecture. The agent runs a persistent heartbeat loop, integrates multiple LLM providers, and operates in a safe simulation environment by default — all controlled through a React-based dashboard with real-time WebSocket log streaming.

## Architecture

The server is organized into the following layers:

| Layer | Path | Description |
|-------|------|-------------|
| **Core** | `server/core/` | `Agent`, `AgentLoop`, `GoalManager`, `MemorySystem`, `Reflector`, `RulesEngine`, `ToolRegistry` |
| **Cognition** | `server/cognition/` | `LLMInterface` — wraps Gemini, OpenAI, Anthropic, Grok, and Ollama APIs |
| **Modules** | `server/modules/` | `Controller`, `Evaluator`, `Executor`, `Planner`, `Sniper`, `Spotter`, `ToolValidator` |
| **Utils** | `server/utils/` | `Logger` — file-backed log with rotation and real-time pub/sub; `SSRF` guard |
| **Tools** | `server/core/tools/` | `BaseTool`, `ToolRegistry`, `HTTPTool`, `FileTool`, `FileWriteTool`, `WebhookTool` |

Each agent cycle follows the RSEA pattern:
1. **Observe** — Spotter gathers live market signals (BTC/USDT from Binance + simulated feeds)
2. **Plan** — Planner decomposes the primary goal into an atomic task tree with LLM support
3. **Evaluate** — Evaluator ranks tasks by risk, value density, and speed
4. **Execute** — Sniper fires the top-ranked task through the Executor
5. **Reflect** — Reflector persists insights to short-term and long-term (vector) memory
6. **Self-Modify** — Controller periodically adjusts its own strategic prompt modifiers via LLM

Actions pass through a two-stage control system before execution:

- **`RulesEngine.apply()`** — confidence-score gate: only tasks scoring above `CONFIDENCE_THRESHOLD` (default 60/100) proceed, further filtered by `DECISION_AGGRESSIVENESS`.
- **`RulesEngine.validate()`** — hard constraint gate run by the Executor on every action: enforces `MAX_ACTIONS_PER_CYCLE`, `RULE_ALLOWED_TOOLS`, `RISK_THRESHOLD`, and `ACTION_TIMEOUT_MS`.
- **`ToolValidator`** — zero-trust LLM output gate in the Sniper: checks tool whitelist and required payload parameters before forwarding to the Executor.

## Prerequisites

- **Node.js** (v22+)
- One of the supported LLM providers:
  - **Google Gemini** — set `GEMINI_API_KEY`
  - **OpenAI** — set `OPENAI_API_KEY`
  - **Anthropic** — set `ANTHROPIC_API_KEY`
  - **Grok (xAI)** — set `XAI_API_KEY`
  - **Ollama** (local) — run `ollama serve` and set `OLLAMA_BASE_URL`
  - If no key is provided, the agent runs in **simulation mode**

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example environment file and add your API key:
   ```bash
   cp .env.example .env.local
   # then edit .env.local and set your preferred LLM provider key
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

## Docker Quick-Start

The fastest way to run RSEA Agent in a container:

```bash
# 1. Build the image
docker build -t rsea-agent:latest .

# 2. Run with simulation mode (safe default — no live execution)
docker run -d \
  --name rsea-agent \
  -p 3000:3000 \
  -e API_SECRET="$(openssl rand -hex 32)" \
  -e DRY_RUN=true \
  -v rsea-data:/app/data \
  rsea-agent:latest

# 3. Tail logs
docker logs -f rsea-agent

# 4. Verify health
curl http://localhost:3000/api/health/live
```

### Using Docker Compose (recommended for local development)

```bash
# Copy and edit the environment file first
cp .env.example .env.local

# Start all services
docker compose up -d

# Tail logs
docker compose logs -f

# Stop
docker compose down
```

Key Compose environment variables to set in `.env.local`:

| Variable | Description |
|----------|-------------|
| `API_SECRET` | Required — generate with `openssl rand -hex 32` |
| `LLM_PROVIDER` | `gemini` / `openai` / `anthropic` / `grok` / `ollama` |
| `GEMINI_API_KEY` | (or whichever provider key you need) |
| `DRY_RUN` | `true` (simulation) or `false` (live execution) |

## Kubernetes Quick-Start

> ⚠️ RSEA Agent uses SQLite and is single-replica only. See [Scaling Notes](#8-scaling-notes) in the runbook.

### Prerequisites

- A Kubernetes cluster (v1.25+) with `kubectl` configured
- A container registry with your built image (replace `your-registry.io/rsea-agent:0.1.0` throughout)

### 1 — Create the namespace

```bash
kubectl create namespace rsea
```

### 2 — Create the Secret (sensitive values)

```bash
kubectl create secret generic rsea-secret \
  --namespace rsea \
  --from-literal=API_SECRET="$(openssl rand -hex 32)" \
  --from-literal=GEMINI_API_KEY="your-gemini-key"   # optional; add the key you use
```

### 3 — Apply the ConfigMap, PVC, Deployment, Service, and NetworkPolicy

```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/network-policy.yaml   # requires a CNI that enforces NetworkPolicy (e.g. Calico, Cilium)
```

### 4 — Verify the rollout

```bash
kubectl rollout status deployment/rsea-agent -n rsea
kubectl get pods -n rsea
kubectl logs -n rsea -l app=rsea-agent --tail=50
```

### 5 — Access the API

```bash
# Port-forward locally for testing
kubectl port-forward -n rsea svc/rsea-agent 3000:3000

# Check health
curl http://localhost:3000/api/health/live

# Check operational metrics (requires API_SECRET)
curl -H "Authorization: Bearer $API_SECRET" http://localhost:3000/api/metrics
```

For production traffic, configure an Ingress resource pointing to the `rsea-agent` Service on port 3000.

## DRY_RUN and the Mainnet Protocol

By default, `DRY_RUN=true` — the executor logs every action but **skips actual execution**. This is the safe, simulation-only mode. To enable live execution (the **Mainnet Protocol**), operators must explicitly set `DRY_RUN=false` in their environment.

## Configuration

Key environment variables (see `.env.example` for the full list):

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | auto-detect | LLM to use: `gemini`, `openai`, `anthropic`, `grok`, `ollama` |
| `API_SECRET` | — | Bearer token for authenticated endpoints (required in production) |
| `DRY_RUN` | `true` | Mainnet-Protocol gate — set to `false` to enable live execution |
| `ALLOW_CODE_EVAL` | `false` | Enable sandboxed JavaScript execution via `code_eval` tool |
| `ALLOW_SELF_MODIFICATION` | `false` | Allow the agent to modify its own prompt modifiers |
| `CONFIDENCE_THRESHOLD` | `60` | Minimum RulesEngine score (0–100) required before executing an action |
| `DECISION_AGGRESSIVENESS` | `0.5` | 0.0 = very conservative, 1.0 = act on any positive signal |
| `VERBOSITY_LEVEL` | `normal` | `silent` \| `normal` \| `verbose` |
| `CYCLE_TIMEOUT_MS` | `30000` | Max wall-clock time per agent cycle (ms) |
| `MAX_ACTIONS_PER_CYCLE` | `10` | Hard cap on actions the RulesEngine will approve in one execution cycle |
| `RISK_THRESHOLD` | `90` | Actions with a risk score above this value (0–100) are blocked by the RulesEngine |
| `ACTION_TIMEOUT_MS` | `5000` | Maximum per-action timeout (ms) the RulesEngine will permit |
| `RULE_ALLOWED_TOOLS` | — | Comma-separated tool allowlist enforced by the RulesEngine (empty = allow all) |
| `SIGNAL_FEED_URL` | — | Optional URL for a custom signal feed (JSON array or object) |
| `MOLTBOOK_API_URL` | — | Moltbook messaging platform base URL |
| `MOLTBOOK_WEBHOOK_SECRET` | — | Required in production when `MOLTBOOK_API_URL` is set |

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/status` | — | Framework version, uptime, and current goals |
| GET | `/api/health` | — | Health check for DB and LLM connections |
| GET | `/api/health/live` | — | Kubernetes **liveness** probe — 200 while the process is running |
| GET | `/api/health/ready` | — | Kubernetes **readiness** probe — 200 when DB + LLM are operational |
| GET | `/api/logs` | required | Last 100 agent log events (REST fallback) |
| GET | `/api/memory` | required | Full memory snapshot (short-term + long-term) |
| GET | `/api/debug/state` | required | Loop telemetry, goal state, memory stats, and config (dryRun, killSwitch) |
| GET | `/api/metrics` | required | Operational metrics as JSON (cycle stats, score distribution, tool outcomes) |
| GET | `/api/metrics/prometheus` | required | Same metrics in **Prometheus text format** for Grafana / scraping |
| POST | `/api/command` | required | Queue a manual instruction for the agent (rate-limited: 20 req/min/IP) |
| POST | `/api/control` | required | `start` / `stop` the loop, or `set_interval` (ms) |
| WS | `/ws/logs` | required | Real-time log stream (sends `history` on connect, `log` on each new event) |

## Security Notes

- **`ALLOW_CODE_EVAL=true`** enables sandboxed JavaScript execution using Node.js `vm`. Note that `vm.createContext` is **not a security boundary** — sandbox escapes are possible. Only enable this in trusted, isolated environments.
- **SSRF protection** is enforced on all outbound HTTP requests (executor `api_fetch` and `http_request`, Spotter `SIGNAL_FEED_URL`). Requests to private/loopback addresses and non-HTTP(S) schemes are blocked.
- **Rate limiting** on `POST /api/command`: max 20 requests per IP per minute.
- All authenticated endpoints require `Authorization: Bearer <API_SECRET>`.
- **WebSocket authentication**: `/ws/logs` accepts the API token via the `Authorization: Bearer` header *or* as a `?token=` URL query parameter for browser clients. Note that the query-parameter method may expose the token in server access logs — prefer header-based auth where possible.
- **Security response headers** (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Content-Security-Policy`) are applied to every response.
- **`ToolValidator`** zero-trust gate: every LLM-generated action is validated against a tool whitelist and required payload parameters before it reaches the Executor.
- **`RulesEngine.validate()`** hard constraint gate: enforces cycle action limits, tool allowlists, risk thresholds, and timeout caps on every action in the Executor.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Express + Vite development server |
| `npm run build` | Build the React frontend for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | TypeScript type-check (no emit) |
| `npm run lint:eslint` | ESLint static analysis (TypeScript rules) |
| `npm run test` | Run all tests |
| `npm run test:coverage` | Run tests with coverage report |

## License

This project is licensed under the [MIT License](LICENSE).
