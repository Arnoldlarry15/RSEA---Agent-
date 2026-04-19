# RSEA Agent

A modular, autonomous AI agent framework following the **Research, Scan, Execute, Act (RSEA)** architecture. The agent runs a persistent heartbeat loop, integrates a pluggable LLM cognition layer (Gemini, OpenAI, Anthropic, Grok, or Ollama), and operates in a safe simulation environment — all controlled through a React-based dashboard with real-time WebSocket log streaming.

## Architecture

The server is organized into the following layers:

| Layer | Path | Description |
|-------|------|-------------|
| **Core** | `server/core/` | `Agent`, `AgentLoop`, `GoalManager`, `MemorySystem`, `Reflector`, `RulesEngine` |
| **Cognition** | `server/cognition/` | `LLMInterface` — wraps Gemini, OpenAI, Anthropic, Grok, and Ollama |
| **Modules** | `server/modules/` | `Controller`, `Evaluator`, `Executor`, `Planner`, `Sniper`, `Spotter`, `ToolValidator` |
| **Adapters** | `server/adapters/` | `MoltbookAdapter` — Moltbook messaging platform integration |
| **Utils** | `server/utils/` | `Logger` — file-backed log with rotation and real-time pub/sub |

Each agent cycle follows the RSEA pattern:
1. **Observe** — Spotter gathers live market signals (BTC/USDT from Binance + simulated feeds)
2. **Plan** — Planner decomposes the primary goal into an atomic task tree with LLM support
3. **Evaluate** — Evaluator ranks tasks by risk, value density, and speed
4. **Execute** — Sniper fires the top-ranked task through the Executor
5. **Reflect** — Reflector persists insights to short-term and long-term (vector) memory
6. **Self-Modify** — Controller periodically adjusts its own strategic prompt modifiers via LLM (requires `ALLOW_SELF_MODIFICATION=true`)

A `RulesEngine` threshold gates all actions before execution.

## Prerequisites

- **Node.js** v18 or later
- An LLM API key for one of the supported providers, **or** a running [Ollama](https://ollama.com) instance for local inference (no API key required).

### Supported LLM Providers

| Provider | Key env var | Notes |
|----------|-------------|-------|
| **Gemini** (Google) | `GEMINI_API_KEY` | `gemini-2.0-flash` for chat, `text-embedding-004` for embeddings |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o` by default; set `OPENAI_MODEL` to override |
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-20241022` by default; set `ANTHROPIC_MODEL` to override |
| **Grok** (xAI) | `XAI_API_KEY` | `grok-3` by default; set `GROK_MODEL` to override |
| **Ollama** (local) | *(none)* | Set `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL` |

Set `LLM_PROVIDER` to the provider name to skip auto-detection. If no key is found the agent runs in **simulation mode** (no external calls; deterministic stubs returned).

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example environment file and set your keys:
   ```bash
   cp .env.example .env.local
   # Edit .env.local — set at least one LLM key and, for production, API_SECRET
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

## API Endpoints

All endpoints that return or accept sensitive data require `Authorization: Bearer <API_SECRET>` unless stated otherwise.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/ping` | None | Liveness probe — returns `"pong"` |
| GET | `/api/status` | None | Framework version, uptime, goals, and config flags |
| GET | `/api/health` | None | Health check for DB and LLM connections (200 = healthy, 503 = unhealthy) |
| GET | `/api/logs` | **Required** | Last 100 agent log events; filter by `?traceId=` |
| GET | `/api/memory` | **Required** | Full memory snapshot (short-term + long-term) |
| GET | `/api/debug/state` | **Required** | Loop telemetry, goal state, and memory stats |
| POST | `/api/command` | **Required** | Queue a manual instruction for the agent (body: `{ command: string }`) |
| POST | `/api/control` | **Required** | Control the agent loop (see actions below) |
| POST | `/api/webhooks/moltbook` | None* | Receive Moltbook platform events (`X-Moltbook-Secret` validated if `MOLTBOOK_WEBHOOK_SECRET` is set) |
| WS | `/ws/logs` | **Required** | Real-time log stream — supply token via `?token=<API_SECRET>` or `Authorization: Bearer` upgrade header |

*Protect the webhook URL at the network level or set `MOLTBOOK_WEBHOOK_SECRET`.

### `POST /api/control` actions

| `action` value | Effect |
|----------------|--------|
| `start` | Start the agent loop |
| `stop` | Stop the agent loop |
| `set_interval` | Change loop interval; supply `interval` (ms) in body |
| `kill_switch_on` | Pause all agent cycles (emergency stop) |
| `kill_switch_off` | Resume agent cycles |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Express + Vite development server |
| `npm run build` | Build the React frontend for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | TypeScript type-check (no emit) |
| `npm run test` | Run all tests |
| `npm run test:coverage` | Run tests and enforce coverage thresholds |

## Security Notes

- **`API_SECRET`** — the server will exit immediately on startup if this is empty in `NODE_ENV=production`.
- **`ALLOW_CODE_EVAL`** — `code_eval` tool is disabled by default. Node's `vm.Script` is not a full sandbox; only enable in isolated environments.
- **`ALLOW_SELF_MODIFICATION`** — LLM-driven prompt modifier rewriting is disabled by default. Enable only under supervision.
- **WebSocket auth** — supply the API secret via `?token=<secret>` or `Authorization: Bearer <secret>` on the WebSocket upgrade request.
- **Webhook injection** — the webhook handler strips `override goal:` prefixes from incoming event content to prevent prompt injection.

## Deployment

### Docker (single container)

```bash
# Build
docker build -t rsea-agent .

# Run (requires API_SECRET and at least one LLM key)
docker run -d \
  -e NODE_ENV=production \
  -e API_SECRET=your_secret \
  -e GEMINI_API_KEY=your_key \
  -v rsea-data:/app/data \
  -p 3000:3000 \
  rsea-agent
```

### Docker Compose

```bash
# Copy and fill in your secrets
cp .env.example .env
# Edit .env, then:
docker compose up -d
```

The compose file mounts a named volume (`rsea-data`) for SQLite persistence and configures a health check on `/api/health`.

### Cloud Run / Fly.io / Railway

1. Build and push the image to a registry (e.g., GHCR).
2. Set the required environment variables as platform secrets:
   - `API_SECRET` (required)
   - `LLM_PROVIDER` + the matching `*_API_KEY` (at least one)
   - `APP_URL` (your service's public URL — used for Moltbook webhook registration)
3. Mount a persistent volume at `/app/data` for SQLite.
4. The container listens on `$PORT` (default 3000); Cloud Run injects this automatically.

## License

This project is licensed under the [MIT License](LICENSE).

