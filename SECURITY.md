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
| `RULE_ALLOWED_TOOLS` | unset (all allowed) | Comma-separated tool allowlist enforced by the RulesEngine before every action |
| `ALLOWED_FETCH_HOSTS` | unset (all public hosts) | Comma-separated hostname allowlist for `api_fetch`; set in high-security environments |
| `ALLOWED_COMMANDS` | unset (none allowed) | Comma-separated list of commands the `system_command` executor may run |
| `MOLTBOOK_REFRESH_URL` | unset | If set, the adapter validates it against the SSRF denylist before using it |
| Rate limiting | 20 req/min/IP | Applies to `POST /api/command` and `POST /api/control`; expired entries pruned every 5 minutes |
| WebSocket token | `Authorization: Bearer` header OR `?token=` query param | **Prefer header auth**; the `?token=` method exposes the secret in server access logs and emits a deprecation warning |
| CSP | `unsafe-inline` / `unsafe-eval` | Required by Tailwind inline styles and Vite dev server; a nonce-based CSP is a future improvement |
| SSRF | Sync + async DNS-rebinding guard | Outbound HTTP in Spotter and `api_fetch` is checked asynchronously. DNS fails open — restrict with `ALLOWED_FETCH_HOSTS` in high-security environments |
| Prompt-injection | `sanitizeContent()` applied at all trust boundaries | Applied to Moltbook webhook content and LLM-generated self-modification modifiers |

## Deployment Checklist

- [ ] `API_SECRET` is set to a strong random value (≥32 random hex chars)
- [ ] `NODE_ENV=production` is set
- [ ] `DRY_RUN=true` unless live execution is intentional and supervised
- [ ] `ALLOW_CODE_EVAL` and `ALLOW_SELF_MODIFICATION` remain `false` unless required
- [ ] `MOLTBOOK_WEBHOOK_SECRET` is set if `MOLTBOOK_API_URL` is configured
- [ ] `TRUST_PROXY=1` (or a specific IP/CIDR) is set when running behind a reverse proxy / cloud load-balancer
- [ ] `DEFAULT_GOAL` is set to a domain-appropriate objective (removes financial-domain default)
- [ ] Consider setting `RULE_ALLOWED_TOOLS` and `ALLOWED_FETCH_HOSTS` to restrict the tool surface
- [ ] The `data/` directory is mounted as a persistent volume (never committed to git)
- [ ] The container runs as the non-root `rsea` user (enforced by the Dockerfile)
- [ ] The SQLite database (`data/memory.db`) is backed up on a schedule — deploy `k8s/backup-cronjob.yaml`
- [ ] The PVC storage class (`k8s/pvc.yaml`) is updated to the correct SSD-backed class for your cloud provider
- [ ] For Kubernetes: `API_SECRET` and all API keys are stored as Kubernetes Secrets, **not** in the ConfigMap
- [ ] CI container scan (Trivy) passes with no CRITICAL or HIGH unfixed CVEs before each release
- [ ] WebSocket clients use `Authorization: Bearer` header instead of `?token=` query parameter
