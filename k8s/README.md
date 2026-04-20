# Kubernetes Deployment Guide

This directory contains production-ready Kubernetes manifests for RSEA Agent.

---

## Prerequisites

- Kubernetes cluster (1.24+)
- `kubectl` configured for your cluster
- Container image published to a registry (see build step below)

---

## Quick Start

### 1. Build and publish the container image

```bash
docker build -t your-registry/rsea-agent:latest .
docker push your-registry/rsea-agent:latest
```

Update the `image:` field in `deployment.yaml` to match your registry path.

### 2. Create the namespace

```bash
kubectl create namespace rsea
```

### 3. Create the Secrets

Never commit real secrets to git. Create them from the command line:

```bash
kubectl create secret generic rsea-secret \
  --from-literal=API_SECRET="$(openssl rand -hex 32)" \
  --from-literal=GEMINI_API_KEY="your-api-key-here" \
  --namespace rsea
```

Add any other provider keys your deployment requires (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `MOLTBOOK_API_TOKEN`, `MOLTBOOK_WEBHOOK_SECRET`).

### 4. Customise the ConfigMap

Edit `configmap.yaml` to match your environment (set `APP_URL`, tune
`CONFIDENCE_THRESHOLD`, etc.), then apply it:

```bash
kubectl apply -f k8s/configmap.yaml
```

### 5. Apply all manifests

```bash
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

### 6. Verify the rollout

```bash
kubectl rollout status deployment/rsea-agent --namespace rsea
kubectl get pods --namespace rsea
```

### 7. Check health

```bash
# Port-forward for local testing
kubectl port-forward svc/rsea-agent 3000:80 --namespace rsea &

curl http://localhost:3000/api/health/live
curl http://localhost:3000/api/health/ready
```

---

## Exposing the Service externally

The `service.yaml` creates a `ClusterIP` service (internal only). To expose
the agent externally, add an Ingress or change the Service type:

```yaml
# Example: add an Ingress (nginx ingress controller required)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: rsea-agent
  namespace: rsea
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
spec:
  rules:
    - host: rsea.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: rsea-agent
                port:
                  name: http
  tls:
    - hosts:
        - rsea.example.com
      secretName: rsea-tls
```

---

## Prometheus Metrics Scraping

The agent exposes a Prometheus-format metrics endpoint at
`/api/metrics/prometheus` (requires `Authorization: Bearer <API_SECRET>`
header).

Example `ServiceMonitor` for the Prometheus Operator:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: rsea-agent
  namespace: rsea
spec:
  selector:
    matchLabels:
      app: rsea-agent
  endpoints:
    - port: http
      path: /api/metrics/prometheus
      bearerTokenSecret:
        name: rsea-secret
        key: API_SECRET
      interval: 30s
```

---

## Scaling Notes

> ⚠️  **Single-replica only.** The SQLite database (`data/memory.db`) does not
> support concurrent write access from multiple pods sharing the same PVC.
> The `accessModes: [ReadWriteOnce]` constraint on the PVC enforces this at the
> storage level, but the Deployment's `replicas: 1` is the primary guard.
>
> To scale horizontally, migrate to a networked database (e.g., PostgreSQL)
> and replace the in-process rate limiter with a shared store (e.g., Redis).

---

## Operator Runbook

See [`docs/runbook.md`](../docs/runbook.md) for procedures covering:

- Kill-switch activation and recovery
- State restore after restart
- API secret rotation
- SQLite backup and restore
- Rolling restart / upgrade
