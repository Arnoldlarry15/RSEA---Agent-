# RSEA Agent — Operator Runbook

This document covers day-to-day operational procedures for running RSEA Agent
in a production environment.

---

## Table of Contents

1. [Kill-Switch Activation & Recovery](#1-kill-switch-activation--recovery)
2. [State Restore After Restart](#2-state-restore-after-restart)
3. [API Secret Rotation](#3-api-secret-rotation)
4. [SQLite Database Backup & Restore](#4-sqlite-database-backup--restore)
5. [Moltbook Webhook Secret Rotation](#5-moltbook-webhook-secret-rotation)
6. [Log Management](#6-log-management)
7. [Rolling Restart / Upgrade](#7-rolling-restart--upgrade)
8. [Scaling Notes](#8-scaling-notes)
9. [Monitoring & Alerting](#9-monitoring--alerting)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Kill-Switch Activation & Recovery

### When to activate

- Consecutive cycle failures spike and auto-activation has not fired yet
- A bad instruction was queued and you need to stop execution immediately
- Maintenance window requiring quiescence

### Activating via API

```bash
curl -s -X POST http://localhost:3000/api/control \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"kill_switch_on"}'
```

### Confirming the kill switch is active

```bash
curl -s http://localhost:3000/api/debug/state \
  -H "Authorization: Bearer $API_SECRET" | jq .config.killSwitch
# should return: true
```

### Deactivating

```bash
curl -s -X POST http://localhost:3000/api/control \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"kill_switch_off"}'
```

### Auto-activation

The loop auto-activates the kill switch after **6 consecutive cycle failures**
(`EXTREME_FAILURE_THRESHOLD`). Check the cause before deactivating:

```bash
curl -s http://localhost:3000/api/logs \
  -H "Authorization: Bearer $API_SECRET" | jq '.[] | select(.stage | test("error|fail"))'
```

---

## 2. State Restore After Restart

RSEA Agent persists goal state and the last active plan to the SQLite database
(`data/memory.db`, key `__agent_runtime_state__`) on every successful cycle.
On restart the state is automatically restored from that key.

### Confirming state was restored

Look for `agent_state_restored` in the logs immediately after startup:

```bash
curl -s http://localhost:3000/api/logs \
  -H "Authorization: Bearer $API_SECRET" | jq '.[] | select(.stage == "agent_state_restored")'
```

### Clearing persisted state (fresh start)

If you want the agent to start from scratch (no saved goals or plan):

```bash
# Option A — delete the DB file (loses all long-term memory too)
rm data/memory.db

# Option B — clear only the runtime state key using sqlite3
sqlite3 data/memory.db \
  "DELETE FROM long_term WHERE key = '__agent_runtime_state__';"
```

After clearing, restart the container/process.

---

## 3. API Secret Rotation

The `API_SECRET` is read from `process.env` on every request, so the new value
takes effect immediately **without a restart** when using a secrets manager that
injects the value at runtime. However:

- **Docker / docker-compose**: update the `API_SECRET` env var and restart the
  container. The old secret is invalid the moment the container stops.
- **Kubernetes**: update the Secret object, then trigger a rolling restart:

```bash
kubectl create secret generic rsea-secret \
  --from-literal=API_SECRET="<new-value>" \
  --namespace rsea \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/rsea-agent --namespace rsea
kubectl rollout status deployment/rsea-agent --namespace rsea
```

> ⚠️  There is a brief window between the container shutdown and the new
> container becoming ready during which the API is unavailable.  If zero-downtime
> rotation is required, implement a secrets-manager sidecar that hot-reloads the
> env var while the process is running.

---

## 4. SQLite Database Backup & Restore

All persistent state (long-term memory, strategy history, agent runtime state,
session memory) lives in `data/memory.db`.

### Backup

```bash
# Option A — online backup via the SQLite .backup pragma (safe while running)
sqlite3 data/memory.db ".backup data/memory.db.bak"

# Option B — copy the file (safest when the container is stopped)
cp data/memory.db data/memory.db.$(date +%Y%m%d%H%M%S).bak

# Option C — from within a Kubernetes pod
kubectl exec -n rsea deploy/rsea-agent -- \
  sqlite3 /app/data/memory.db ".backup /app/data/memory.db.bak"
kubectl cp rsea/<pod-name>:/app/data/memory.db.bak ./memory.db.bak
```

### Restore

```bash
# Stop the agent first
curl -s -X POST http://localhost:3000/api/control \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}'

# Replace the DB file
cp data/memory.db.bak data/memory.db

# Restart the container / process
```

### Automated backups

For production, consider a cron job or Kubernetes CronJob that runs the
`.backup` command and copies the file to object storage (S3, GCS, etc.).

---

## 5. Moltbook Webhook Secret Rotation

1. Generate a new secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update the secret in the Moltbook platform dashboard.
3. Update `MOLTBOOK_WEBHOOK_SECRET` in your environment / Kubernetes Secret.
4. Restart the RSEA Agent container.

> The server validates the `X-Moltbook-Secret` header on every incoming
> webhook.  Any requests using the old secret will be rejected with HTTP 200
> but `processed: false` after the rotation.

---

## 6. Log Management

Logs are stored in `data/logs.json` (JSONL format, max 500 lines after
rotation).  Real-time streaming is available via WebSocket (`/ws/logs`) or the
REST fallback (`GET /api/logs`, last 100 entries).

### Reading logs

```bash
# Last 20 log entries (jq optional)
curl -s http://localhost:3000/api/logs \
  -H "Authorization: Bearer $API_SECRET" | jq '.[-20:]'

# Filter by trace ID
curl -s "http://localhost:3000/api/logs?traceId=<id>" \
  -H "Authorization: Bearer $API_SECRET"

# Read the raw JSONL file
tail -n 50 data/logs.json | jq .
```

### Exporting logs

The `data/logs.json` file is plain JSONL.  You can ship it to a log aggregator
(ELK, CloudWatch, Loki) by tail-following the file with a log agent (e.g.,
Fluent Bit with a `tail` input).

---

## 7. Rolling Restart / Upgrade

> ⚠️  RSEA Agent currently uses SQLite for persistence, which does not support
> concurrent write access from multiple processes.  **Do not run two instances
> sharing the same data volume simultaneously.**

### Docker Compose

```bash
docker compose pull          # pull new image if using a registry
docker compose up -d         # recreate the container (brief downtime)
docker compose logs -f       # watch startup
```

### Kubernetes

The Deployment is configured with `strategy: RollingUpdate` but with
`maxUnavailable: 0` and `maxSurge: 1`.  This means a new pod starts before the
old one is stopped.  **Because both pods share the same PVC, the new pod must
not write to the DB while the old one is still running.**

Recommended approach for zero-data-loss upgrades:
1. Activate the kill switch on the running pod (stops DB writes):
   ```bash
   kubectl exec -n rsea deploy/rsea-agent -- \
     curl -s -X POST http://localhost:3000/api/control \
       -H "Authorization: Bearer $API_SECRET" \
       -H "Content-Type: application/json" \
       -d '{"action":"kill_switch_on"}'
   ```
2. Trigger the rollout:
   ```bash
   kubectl set image deployment/rsea-agent rsea-agent=<new-image> -n rsea
   ```
3. Monitor:
   ```bash
   kubectl rollout status deployment/rsea-agent -n rsea
   ```

---

## 8. Scaling Notes

- **Single-replica only**: The SQLite database and in-process metrics/rate-limiter
  do not support horizontal scaling.  Running multiple replicas with a shared PVC
  will cause DB corruption.
- To scale horizontally, migrate to a networked database (PostgreSQL) and replace
  the in-process rate limiter with a shared store (Redis).
- Vertical scaling (increasing container CPU/memory limits) is safe and
  recommended for high-throughput workloads.

---

## 9. Monitoring & Alerting

### Prometheus / Grafana

RSEA Agent exposes metrics in Prometheus text format at `GET /api/metrics/prometheus`.
Add the following scrape config to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: rsea-agent
    bearer_token: <your-API_SECRET>
    static_configs:
      - targets: ['<host>:3000']
    metrics_path: /api/metrics/prometheus
```

Key metrics to dashboard and alert on:

| Metric | Alert threshold | Meaning |
|--------|----------------|---------|
| `rsea_success_rate_percent` | < 50 for > 5 minutes | More than half of evaluations are failing |
| `rsea_risk_gate_blocks_total` | increase > 10 within 5 minutes | Abnormal burst of hard-blocked actions; check bans |
| `rsea_score_avg` | < 40 for > 5 minutes | Average evaluation score below acceptable range |
| `rsea_cycles_total` | no change for > 15 minutes | Agent loop has stalled or been stopped |

### Health Probes

Liveness and readiness probes are registered in the Kubernetes `deployment.yaml`:

- `GET /api/health/live` — returns `200` while the process is running.
  - Kubernetes restarts the container if this fails 3 times.
- `GET /api/health/ready` — returns `200` only when DB and LLM subsystems are healthy.
  - Kubernetes stops routing traffic to the pod while this is failing.

Manually check health at any time:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/ready
```

### Real-time log streaming (WebSocket)

```bash
# Using wscat (npm install -g wscat)
wscat -c "ws://localhost:3000/ws/logs?token=$API_SECRET"
```

Each WebSocket message is a JSON object with a `type` field (`history` on connect,
`log` for each new event).

---

## 10. Troubleshooting

### Agent loop is not running

**Symptom**: `GET /api/status` shows no recent goal activity; logs are silent.

1. Check the kill switch:
   ```bash
   curl -s http://localhost:3000/api/debug/state \
     -H "Authorization: Bearer $API_SECRET" | jq .config.killSwitch
   ```
   If `true`, deactivate it:
   ```bash
   curl -s -X POST http://localhost:3000/api/control \
     -H "Authorization: Bearer $API_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"action":"kill_switch_off"}'
   ```

2. Check for crash errors in logs:
   ```bash
   curl -s http://localhost:3000/api/logs \
     -H "Authorization: Bearer $API_SECRET" \
     | jq '.[] | select(.stage | test("error|fail|kill"))'
   ```

3. Restart the agent loop if needed:
   ```bash
   curl -s -X POST http://localhost:3000/api/control \
     -H "Authorization: Bearer $API_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"action":"start"}'
   ```

---

### All actions are being blocked (risk gate)

**Symptom**: `rsea_risk_gate_blocks_total` is rising; `results` contain only `blocked` entries.

1. Fetch current metrics to identify the blocked tools:
   ```bash
   curl -s http://localhost:3000/api/metrics \
     -H "Authorization: Bearer $API_SECRET" | jq .toolOutcomes
   ```

2. Check memory for banned tools (set by the Reflector after repeated failures):
   ```bash
   curl -s http://localhost:3000/api/memory \
     -H "Authorization: Bearer $API_SECRET" \
     | jq '.longTerm.REFLECTOR_BANS'
   ```

3. If a tool was banned incorrectly, clear the ban by directly editing the SQLite
   database:
   ```bash
   sqlite3 data/memory.db \
     "DELETE FROM long_term WHERE key = 'REFLECTOR_BANS';"
   ```
   Then restart the container so the in-memory snapshot is refreshed.

---

### High memory usage

**Symptom**: Container RSS is growing over time.

- The short-term memory ring-buffer is capped; long-term memory is SQLite-backed.
- Check whether log rotation is keeping `data/logs.json` under 500 lines:
  ```bash
  wc -l data/logs.json
  ```
- The deduplication set for Moltbook webhooks is capped at 10 000 entries and is
  persisted to `data/moltbook_dedup.json`.  Large dedup files can be cleared
  safely on restart:
  ```bash
  rm data/moltbook_dedup.json
  ```

---

### LLM provider errors / fallback to simulation

**Symptom**: Logs contain `analyze error` or `complete error`; agent operates in
simulation mode.

1. Confirm the provider and API key are set:
   ```bash
   curl -s http://localhost:3000/api/health \
     -H "Authorization: Bearer $API_SECRET" | jq .components
   ```

2. Check for provider-specific error messages in logs:
   ```bash
   curl -s http://localhost:3000/api/logs \
     -H "Authorization: Bearer $API_SECRET" \
     | jq '.[] | select(.stage | test("llm|analyze|complete"))'
   ```

3. Verify the API key is not a placeholder (starts with `MY_` or equals
   `your_key_here`) — these are blocked by the `isPlaceholder()` guard in `llm.ts`.

---

### Database corruption or missing tables

**Symptom**: Container exits with a SQLite error on startup; health check fails.

1. Restore from backup (see [Section 4](#4-sqlite-database-backup--restore)).
2. If no backup exists, delete the DB and accept a fresh start:
   ```bash
   rm data/memory.db
   # restart the container
   ```
   All long-term memory and strategy history will be lost, but the agent will
   re-initialise cleanly.

---

### 503 from /api/health/ready (Kubernetes)

**Symptom**: Pod is running but traffic is not being routed to it.

- The readiness probe (`/api/health/ready`) returns 503 when the DB or LLM
  subsystems report unhealthy.
- Common causes: the SQLite file is locked by a previous instance, or the LLM
  API key is missing/invalid.
- Check pod events and logs:
  ```bash
  kubectl describe pod -n rsea -l app=rsea-agent
  kubectl logs -n rsea -l app=rsea-agent --tail=100
  ```

