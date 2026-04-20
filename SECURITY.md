# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main`  | ✅ Yes    |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

Instead, send a detailed description to the repository maintainers via a [GitHub private security advisory](https://github.com/Arnoldlarry15/RSEA---Agent-/security/advisories/new).

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept code if applicable)
- The affected file(s) and line numbers
- Your suggested remediation (optional but appreciated)

You can expect an acknowledgement within **72 hours** and a patch timeline within **14 days** for confirmed critical issues.

## Security Controls

| Control | Default | Override |
|---------|---------|---------|
| `DRY_RUN` | `true` | Set `DRY_RUN=false` to enable live execution |
| `ALLOW_CODE_EVAL` | `false` | Set `ALLOW_CODE_EVAL=true` to permit `code_eval` actions |
| `ALLOW_SELF_MODIFICATION` | `false` | Set `ALLOW_SELF_MODIFICATION=true` + `DRY_RUN=false` to enable LLM self-modification |
| `API_SECRET` | unset (dev) | **Required** in `NODE_ENV=production`; server exits on startup if missing |
| Rate limiting | 20 req/min/IP | Applies to `POST /api/command` and `POST /api/control` |
| WebSocket token | `Authorization: Bearer` header OR `?token=` query param | Prefer header auth; the `?token=` method exposes the secret in server access logs |

## Deployment Checklist

- [ ] `API_SECRET` is set to a strong random value
- [ ] `NODE_ENV=production` is set
- [ ] `DRY_RUN=true` unless live execution is intentional
- [ ] `ALLOW_CODE_EVAL` and `ALLOW_SELF_MODIFICATION` remain `false` unless required
- [ ] `MOLTBOOK_WEBHOOK_SECRET` is set if `MOLTBOOK_API_URL` is configured
- [ ] The `data/` directory is mounted as a persistent volume (never committed to git)
- [ ] The container runs as the non-root `rsea` user (enforced by the Dockerfile)
- [ ] The SQLite database (`data/memory.db`) is backed up regularly (see `docs/runbook.md`)
- [ ] For Kubernetes deployments: `API_SECRET` and other credentials are stored as Kubernetes Secrets, not ConfigMaps
