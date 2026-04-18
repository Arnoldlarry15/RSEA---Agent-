import vm from 'vm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logEvent } from '../utils/logger';
import { isSsrfTarget } from '../utils/ssrf';
import { sendMessage as moltbookSend, fetchThread as moltbookFetch } from '../adapters/moltbook';
import { ToolRegistry, createDefaultRegistry } from '../core/tools/index';
import { RulesEngine } from '../core/rules';

const execFileAsync = promisify(execFile);

/** Maximum number of characters accepted by the code_eval executor. */
const MAX_CODE_SIZE = 10_000;

/**
 * Mainnet-Protocol gate: DRY_RUN defaults to true for safety.
 * Operators must explicitly set DRY_RUN=false to enable live execution.
 * Read dynamically so tests can override process.env.DRY_RUN at runtime.
 */
function isDryRun(): boolean {
  return (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
}

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

export interface ExecutionConstraints {
  /** Override the global DRY_RUN setting for this batch of actions. */
  dryRun?: boolean;
  /** If provided, only tools in this list are permitted. */
  allowedTools?: string[];
  /** Per-request timeout override in milliseconds. */
  timeout?: number;
}

export class Executor {
  private registry: ToolRegistry;

  constructor(registry?: ToolRegistry) {
    this.registry = registry ?? createDefaultRegistry();
  }

  /**
   * Executes tools, code, or APIs based on decision outputs.
   * @param actions  Array of action objects produced by the planner/sniper.
   * @param constraints  Optional runtime constraints (dryRun, allowedTools, timeout).
   */
  async execute(actions: any[], constraints?: ExecutionConstraints) {
    const results = [];
    // Fresh RulesEngine per execute() call so the per-cycle counter starts at zero.
    const ruleEngine = new RulesEngine();
    
    for (const action of actions) {
      const effectiveDryRun = constraints?.dryRun ?? isDryRun();
      logEvent('executor_start', { action, dryRun: effectiveDryRun });

      // ── RulesEngine hard-constraint gate ─────────────────────────────────────
      const ruleValidation = ruleEngine.validate(action);
      if (!ruleValidation.allowed) {
        logEvent('executor_blocked', { reason: ruleValidation.reason, action });
        results.push({
          status: 'blocked',
          timestamp: new Date().toISOString(),
          action,
          outcome: ruleValidation.reason,
          priority: action.action === 'priority_alert' ? 'CRITICAL' : 'STANDARD',
          result: null,
          success: false,
          error: ruleValidation.reason,
          side_effects: [],
          confidence: 0,
        });
        continue;
      }

      // Constraints: optional tool allowlist
      if (constraints?.allowedTools && !constraints.allowedTools.includes(action.tool)) {
        logEvent('executor_blocked', { reason: 'Tool not in constraints.allowedTools', tool: action.tool });
        results.push({
          status: 'blocked',
          timestamp: new Date().toISOString(),
          action,
          outcome: `Tool '${action.tool}' is not permitted by execution constraints`,
          priority: action.action === 'priority_alert' ? 'CRITICAL' : 'STANDARD',
          result: null,
          success: false,
          error: `Tool '${action.tool}' is not permitted by execution constraints`,
          side_effects: [],
          confidence: 0,
        });
        continue;
      }

      // In dry-run mode skip actual execution and return a simulated result
      if (effectiveDryRun) {
        results.push({
          status: 'dry_run',
          timestamp: new Date().toISOString(),
          action,
          outcome: `DRY RUN — would have executed tool '${action.tool}'`,
          priority: action.action === 'priority_alert' ? 'CRITICAL' : 'STANDARD',
          result: null,
          success: false,
          error: null,
          side_effects: [],
          confidence: 0,
        });
        continue;
      }

      // --- Dispatch to tool registry first ---
      const registryTool = this.registry.get(action.tool);
      if (registryTool) {
        const toolResult = await registryTool.execute(action.payload ?? {});
        logEvent('executor_result', { tool: action.tool, success: toolResult.success, error: toolResult.error });
        results.push({
          status: toolResult.success ? 'executed' : (toolResult.error?.includes('blocked') ? 'blocked' : 'failed'),
          timestamp: new Date().toISOString(),
          action,
          outcome: toolResult.success
            ? `Tool '${action.tool}' executed successfully`
            : (toolResult.error ?? 'Unknown error'),
          priority: action.action === 'priority_alert' ? 'CRITICAL' : 'STANDARD',
          result: toolResult.result,
          success: toolResult.success,
          error: toolResult.error,
          side_effects: toolResult.side_effects,
          confidence: toolResult.confidence,
        });
        continue;
      }

      // --- Legacy built-in tools ---
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
        priority: action.action === 'priority_alert' ? 'CRITICAL' : 'STANDARD',
        result: outcome,
        success: status === 'executed' || status === 'simulated',
        error: status === 'failed' ? outcome : null,
        side_effects: [],
        confidence: status === 'executed' || status === 'simulated' ? 1.0 : 0,
      });
    }

    return results;
  }
}
