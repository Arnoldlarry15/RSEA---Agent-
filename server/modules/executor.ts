import vm from 'vm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logEvent } from '../utils/logger';
import { sendMessage as moltbookSend, fetchThread as moltbookFetch } from '../adapters/moltbook';

const execFileAsync = promisify(execFile);

/** Hostnames / IP patterns that must never be reached by api_fetch (SSRF guard). */
const IP_OCTET = '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)';
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  new RegExp(`^127\\.${IP_OCTET}\\.${IP_OCTET}\\.${IP_OCTET}$`),    // 127.0.0.0/8 loopback
  /^0\.0\.0\.0$/,
  /^::1$/,                                                              // IPv6 loopback
  new RegExp(`^10\\.${IP_OCTET}\\.${IP_OCTET}\\.${IP_OCTET}$`),       // RFC-1918 10/8
  new RegExp(`^172\\.(1[6-9]|2[0-9]|3[0-1])\\.${IP_OCTET}\\.${IP_OCTET}$`),  // RFC-1918 172.16/12
  new RegExp(`^192\\.168\\.${IP_OCTET}\\.${IP_OCTET}$`),              // RFC-1918 192.168/16
  new RegExp(`^169\\.254\\.${IP_OCTET}\\.${IP_OCTET}$`),              // Link-local / cloud metadata
  /^fd[0-9a-f]{2}:/i,                                                  // IPv6 ULA fc00::/7
];

/** Returns true when the URL targets a private/loopback address or uses a disallowed scheme. */
function isSsrfTarget(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true; // Malformed URL — block it
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true; // Only HTTP(S) outbound requests are allowed
  }
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(parsed.hostname));
}

/** Maximum number of characters accepted by the code_eval executor. */
const MAX_CODE_SIZE = 10_000;

/** When DRY_RUN=true the executor logs every action but skips actual execution. */
const DRY_RUN = (process.env.DRY_RUN ?? '').toLowerCase() === 'true';

/** Safe argument pattern: alphanumeric, hyphens, dots, underscores, forward slashes, @, = */
const SAFE_ARG_PATTERN = /^[a-zA-Z0-9\-._/@=:,]+$/;

/** Outbound HTTP request timeout in milliseconds (default: 10 s). */
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '10000', 10);

/** Maximum number of retry attempts for transient api_fetch failures. */
const MAX_FETCH_RETRIES = parseInt(process.env.MAX_FETCH_RETRIES ?? '3', 10);

/**
 * Fetch with a hard timeout via AbortController.
 * Throws on timeout or network error; does NOT retry — callers handle retries.
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with exponential-backoff retry for transient failures (5xx / network errors).
 * Returns the Response on success, throws on final failure.
 */
async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options);
      // Retry on 429 / 5xx
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < MAX_FETCH_RETRIES) {
          const delay = Math.min(500 * Math.pow(2, attempt), 8000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (err: any) {
      lastErr = err;
      if (attempt < MAX_FETCH_RETRIES) {
        const delay = Math.min(500 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export class Executor {
  /**
   * Executes tools, code, or APIs based on decision outputs.
   */
  async execute(actions: any[]) {
    const results = [];
    
    for (const action of actions) {
      logEvent('executor_start', { action, dryRun: DRY_RUN });

      // In dry-run mode skip actual execution and return a simulated result
      if (DRY_RUN) {
        results.push({
          status: 'dry_run',
          timestamp: new Date().toISOString(),
          action,
          outcome: `DRY RUN — would have executed tool '${action.tool}'`,
          priority: action.action === 'priority_alert' ? 'CRITICAL' : 'STANDARD',
        });
        continue;
      }

      let outcome = 'Success';
      let status = 'executed';
      
      try {
        if (action.tool === 'api_fetch') {
          if (!action.payload || !action.payload.url) {
            throw new Error("Missing URL for api_fetch tool");
          }
          const targetUrl: string = action.payload.url;
          if (isSsrfTarget(targetUrl)) {
            logEvent('executor_blocked', { reason: 'SSRF target blocked', url: targetUrl });
            status = 'blocked';
            outcome = `Request to '${targetUrl}' was blocked (private/loopback/non-HTTP target)`;
          } else {
            // Optional host allowlist: ALLOWED_FETCH_HOSTS=api.example.com,data.example.com
            const allowedHosts = (process.env.ALLOWED_FETCH_HOSTS ?? '')
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean);
            const parsed = new URL(targetUrl);
            if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname)) {
              logEvent('executor_blocked', { reason: 'host not in ALLOWED_FETCH_HOSTS', host: parsed.hostname });
              status = 'blocked';
              outcome = `Host '${parsed.hostname}' is not in the ALLOWED_FETCH_HOSTS allowlist`;
            } else {
              const res = await fetchWithRetry(targetUrl, action.payload.options || {});
              outcome = `API Call completed with status ${res.status}`;
            }
          }
        } else if (action.tool === 'code_eval') {
          // SEC-3: code_eval must be explicitly opted-in via ALLOW_CODE_EVAL=true.
          // Node.js vm.createContext is NOT a security boundary — sandbox escapes are possible.
          const allowCodeEval = (process.env.ALLOW_CODE_EVAL ?? '').toLowerCase() === 'true';
          if (!allowCodeEval) {
            logEvent('executor_blocked', { reason: 'code_eval is disabled; set ALLOW_CODE_EVAL=true to enable', action });
            status = 'blocked';
            outcome = 'code_eval is disabled. Set ALLOW_CODE_EVAL=true to enable this tool (see security documentation).';
          } else {
          const code: string = action.payload?.code ?? '';
          if (code.length > MAX_CODE_SIZE) {
            throw new Error(`Code too large: ${code.length} chars (max ${MAX_CODE_SIZE})`);
          }
          let capturedOutput = '';
          const sandbox = {
            console: {
              log: (...args: any[]) => { capturedOutput += args.map(String).join(' ') + '\n'; },
              error: (...args: any[]) => { capturedOutput += args.map(String).join(' ') + '\n'; },
              warn: (...args: any[]) => { capturedOutput += args.map(String).join(' ') + '\n'; }
            }
          };
          // Deny access to require, process, fs — sandbox has only the mock console
          const script = new vm.Script(code);
          script.runInNewContext(vm.createContext(sandbox), { timeout: 2000 });
          outcome = capturedOutput || '(no output)';
          }
        } else if (action.tool === 'system_command') {
          const rawCommand: string = action.payload?.command ?? '';
          const parts = rawCommand.trim().split(/\s+/);
          const cmd = parts[0];
          const args = parts.slice(1);
          const allowlist = (process.env.ALLOWED_COMMANDS ?? '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (!allowlist.includes(cmd)) {
            logEvent('executor_blocked', { reason: 'command not in allowlist', command: cmd });
            status = 'blocked';
            outcome = `Command '${cmd}' is not permitted (not in ALLOWED_COMMANDS allowlist)`;
          } else {
            // SEC-9: Validate each argument against a safe pattern to prevent argument injection
            const unsafeArgs = args.filter(a => !SAFE_ARG_PATTERN.test(a));
            if (unsafeArgs.length > 0) {
              logEvent('executor_blocked', { reason: 'unsafe argument pattern', unsafeArgs, command: cmd });
              status = 'blocked';
              outcome = `Command '${cmd}' was blocked: argument(s) contain unsafe characters`;
            } else {
            const { stdout, stderr } = await execFileAsync(cmd, args);
            outcome = stdout || stderr || '(no output)';
            }
          }
        } else if (action.tool === 'simulate') {
          const luck = Math.random();
          if (luck > 0.95) outcome = `Anomaly: Collision detected for simulated task (${action.payload.info || ''}).`;
          else outcome = `Simulated Execution optimized successfully for: ${action.payload.info || ''}`;
          status = 'simulated';
        } else if (action.tool === 'moltbook_send_message') {
          const { threadId, content } = action.payload ?? {};
          if (!threadId || !content) {
            throw new Error('moltbook_send_message requires payload.threadId and payload.content');
          }
          const result = await moltbookSend(String(threadId), String(content));
          outcome = `Message sent to Moltbook thread '${threadId}': ${JSON.stringify(result)}`;
        } else if (action.tool === 'moltbook_fetch_thread') {
          const { threadId, page, limit } = action.payload ?? {};
          if (!threadId) {
            throw new Error('moltbook_fetch_thread requires payload.threadId');
          }
          const result = await moltbookFetch(
            String(threadId),
            page !== undefined ? Number(page) : 1,
            limit !== undefined ? Number(limit) : 50
          );
          outcome = `Fetched Moltbook thread '${threadId}': ${JSON.stringify(result)}`;
        } else {
          outcome = `Unknown tool: ${action.tool}`;
          status = 'failed';
        }
      } catch (err: any) {
        status = 'failed';
        outcome = `Error: ${err.message}`;
      }

      results.push({
        status,
        timestamp: new Date().toISOString(),
        action,
        outcome,
        priority: action.action === 'priority_alert' ? 'CRITICAL' : 'STANDARD'
      });
    }

    return results;
  }
}
