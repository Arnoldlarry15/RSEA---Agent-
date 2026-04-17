<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# RSEA Agent

A modular, autonomous AI agent framework following the **Research, Scan, Execute, Act (RSEA)** architecture. The agent runs a persistent heartbeat loop, integrates a Gemini-powered cognition layer, and operates in a safe simulation environment — all controlled through a React-based dashboard.

## Architecture

The server is organized into the following layers:

| Layer | Path | Description |
|-------|------|-------------|
| **Core** | `server/core/` | `Agent`, `AgentLoop`, `GoalManager`, `MemorySystem`, `Reflector`, `RulesEngine` |
| **Cognition** | `server/cognition/` | `LLMInterface` — wraps the Google Gemini API |
| **Modules** | `server/modules/` | `Controller`, `Evaluator`, `Executor`, `Planner`, `Sniper`, `Spotter` |
| **Economy** | `server/economy/` | `Simulator` — safe simulated execution environment |
| **Logic** | `server/logic/` | `Scorer` — signal scoring and threshold checks |
| **Utils** | `server/utils/` | `Logger` |

Each agent cycle follows the RSEA pattern:
1. **Observe** — Spotter gathers signals
2. **Think** — Planner + Evaluator reason over goals and instructions with LLM support
3. **Execute** — Sniper fires actions through the Simulator (simulation mode by default)
4. **Reflect** — Reflector persists outcomes to short-term and long-term memory

A `RulesEngine` threshold (60/100) gates all actions before execution.

## Prerequisites

- **Node.js** (v18+)
- A **Google Gemini API key**

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example environment file and add your Gemini API key:
   ```bash
   cp .env.example .env.local
   # then edit .env.local and set GEMINI_API_KEY=your_key_here
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/status` | Framework version, uptime, and current goals |
| GET | `/api/health` | Health check for DB and LLM connections |
| GET | `/api/logs` | Last 100 agent log events |
| GET | `/api/memory` | Full memory snapshot (short-term + long-term) |
| GET | `/api/debug/state` | Loop telemetry, goal state, and memory stats |
| POST | `/api/command` | Queue a manual instruction for the agent |
| POST | `/api/control` | `start` / `stop` the loop, or `set_interval` (ms) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Express + Vite development server |
| `npm run build` | Build the React frontend for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | TypeScript type-check (no emit) |

## License

This project is licensed under the [MIT License](LICENSE).
