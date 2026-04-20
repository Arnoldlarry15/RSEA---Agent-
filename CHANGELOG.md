# Changelog

All notable changes to RSEA Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Kubernetes deployment manifests (`k8s/`) with Deployment, Service, PVC,
  ConfigMap example, and a deployment guide (`k8s/README.md`).
- Separate liveness (`GET /api/health/live`) and readiness (`GET /api/health/ready`)
  health-check endpoints for Kubernetes probes.
- Prometheus-format metrics scrape endpoint (`GET /api/metrics/prometheus`) exposing
  cycle metrics in OpenMetrics text format for Grafana / Prometheus integration.
- Operator runbook (`docs/runbook.md`) covering kill-switch activation, state
  restore, API secret rotation, and SQLite backup/restore.
- Dependabot configuration (`.github/dependabot.yml`) for weekly npm and
  GitHub Actions dependency updates.
- ESLint configuration (`eslint.config.js`) with TypeScript-aware rules; new
  `npm run lint:eslint` script.

### Changed
- **package.json**: moved frontend-only packages (`react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `@tailwindcss/vite`, `lucide-react`, `motion`) from
  `dependencies` to `devDependencies`.  The production Docker image no longer
  installs these packages, reducing image size and attack surface.
- **package.json**: removed duplicate `vite` entry from `dependencies`
  (it was already listed in `devDependencies`).
- **package.json**: bumped version from `0.0.0` to `0.1.0`.
- **server/utils/logger.ts**: log rotation is now asynchronous (deferred via
  `setImmediate`) so the event loop is no longer blocked on the hot logging path.
- **README.md**: documented new `/api/health/live`, `/api/health/ready`, and
  `/api/metrics/prometheus` endpoints; added security note on WebSocket token
  in URL query parameter.
- **SECURITY.md**: added WebSocket token security note and deployment checklist
  items for Kubernetes.
- **Dockerfile / docker-compose.yml**: added comment about compiling server to
  JavaScript as a future improvement.

---

## [0.0.0] — Initial development

Initial internal release of the RSEA (Research, Scan, Execute, Act) autonomous
agent framework.

### Added
- RSEA agent core: Spotter → Planner → Evaluator → Sniper → Executor → Reflector
  cycle with LLM integration (Gemini, OpenAI, Anthropic, Grok, Ollama).
- Three-tier memory system: episodic, semantic (vector search via sqlite-vec),
  strategic — backed by SQLite.
- Phase 5–9 features: strategy versioning + auto-rollback, adversarial red-team
  cycles, outcome verification, PreExecutionRiskGate, Reflector ban authority.
- Express HTTP API with auth, rate-limiting, security headers, and SSRF guard.
- React dashboard with real-time WebSocket log streaming.
- Multi-stage Docker build, `docker-compose.yml`, graceful shutdown.
- Comprehensive test suite (500+ unit and integration tests, 75 %+ coverage).
- GitHub Actions CI: type-check, security audit, tests, frontend build.
