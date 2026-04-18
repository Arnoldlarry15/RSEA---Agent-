# RSEA Agent

A modular, autonomous AI agent framework following the **Research, Scan, Execute, Act (RSEA)** architecture. The agent runs a persistent heartbeat loop, integrates multiple LLM providers, and operates in a safe simulation environment by default — all controlled through a React-based dashboard with real-time WebSocket log streaming.

## Architecture

The server is organized into the following layers:

| Layer | Path | Description |
|-------|------|-------------|
| **Core** | `server/core/` | `Agent`, `AgentLoop`, `GoalManager`, `MemorySystem`, `Reflector`, `RulesEngine` |
| **Cognition** | `server/cognition/` | `LLMInterface` — wraps Gemini, OpenAI, Anthropic, Grok, and Ollama APIs |
| **Modules** | `server/modules/` | `Controller`, `Evaluator`, `Executor`, `Planner`, `Sniper`, `Spotter` |
| **Utils** | `server/utils/` | `Logger` — file-backed log with rotation and real-time pub/sub; `SSRF` guard |

Each agent cycle follows the RSEA pattern:
1. **Observe** — Spotter gathers live market signals (BTC/USDT from Binance + simulated feeds)
2. **Plan** — Planner decomposes the primary goal into an atomic task tree with LLM support
3. **Evaluate** — Evaluator ranks tasks by risk, value density, and speed
4. **Execute** — Sniper fires the top-ranked task through the Executor
5. **Reflect** — Reflector persists insights to short-term and long-term (vector) memory
6. **Self-Modify** — Controller periodically adjusts its own strategic prompt modifiers via LLM

A `RulesEngine` threshold (60/100) gates all actions before execution.

## Prerequisites

- **Node.js** (v18+)
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
| `SIGNAL_FEED_URL` | — | Optional URL for a custom signal feed (JSON array or object) |
| `MOLTBOOK_API_URL` | — | Moltbook messaging platform base URL |
| `MOLTBOOK_WEBHOOK_SECRET` | — | Required in production when `MOLTBOOK_API_URL` is set |

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/status` | — | Framework version, uptime, and current goals |
| GET | `/api/health` | — | Health check for DB and LLM connections |
| GET | `/api/logs` | required | Last 100 agent log events (REST fallback) |
| GET | `/api/memory` | required | Full memory snapshot (short-term + long-term) |
| GET | `/api/debug/state` | required | Loop telemetry, goal state, memory stats, and config (dryRun, killSwitch) |
| POST | `/api/command` | required | Queue a manual instruction for the agent (rate-limited: 20 req/min/IP) |
| POST | `/api/control` | required | `start` / `stop` the loop, or `set_interval` (ms) |
| WS | `/ws/logs` | required | Real-time log stream (sends `history` on connect, `log` on each new event) |

## Security Notes

- **`ALLOW_CODE_EVAL=true`** enables sandboxed JavaScript execution using Node.js `vm`. Note that `vm.createContext` is **not a security boundary** — sandbox escapes are possible. Only enable this in trusted, isolated environments.
- **SSRF protection** is enforced on all outbound HTTP requests (executor `api_fetch`, Spotter `SIGNAL_FEED_URL`). Requests to private/loopback addresses are blocked.
- **Rate limiting** on `POST /api/command`: max 20 requests per IP per minute.
- All authenticated endpoints require `Authorization: Bearer <API_SECRET>`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Express + Vite development server |
| `npm run build` | Build the React frontend for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | TypeScript type-check (no emit) |
| `npm run test` | Run all tests |
| `npm run test:coverage` | Run tests with coverage report |

## License

This project is licensed under the [MIT License](LICENSE).
