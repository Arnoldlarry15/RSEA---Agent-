import vm from 'vm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logEvent } from '../utils/logger';

const execFileAsync = promisify(execFile);

/** Hostnames / IP patterns that must never be reached by api_fetch (SSRF guard). */
const OCT = '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)';
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  new RegExp(`^127\\.${OCT}\\.${OCT}\\.${OCT}$`),    // 127.0.0.0/8 loopback
  /^0\.0\.0\.0$/,
  /^::1$/,                                              // IPv6 loopback
  new RegExp(`^10\\.${OCT}\\.${OCT}\\.${OCT}$`),       // RFC-1918 10/8
  new RegExp(`^172\\.(1[6-9]|2[0-9]|3[01])\\.${OCT}\\.${OCT}$`),  // RFC-1918 172.16/12
  new RegExp(`^192\\.168\\.${OCT}\\.${OCT}$`),         // RFC-1918 192.168/16
  new RegExp(`^169\\.254\\.${OCT}\\.${OCT}$`),         // Link-local / cloud metadata
  /^fd[0-9a-f]{2}:/i,                                  // IPv6 ULA fc00::/7
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

export class Executor {
  /**
   * Executes tools, code, or APIs based on decision outputs.
   */
  async execute(actions: any[]) {
    const results = [];
    
    for (const action of actions) {
      logEvent('executor_start', action);
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
              const res = await fetch(targetUrl, action.payload.options || {});
              outcome = `API Call completed with status ${res.status}`;
            }
          }
        } else if (action.tool === 'code_eval') {
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
            const { stdout, stderr } = await execFileAsync(cmd, args);
            outcome = stdout || stderr || '(no output)';
          }
        } else if (action.tool === 'simulate') {
          const luck = Math.random();
          if (luck > 0.95) outcome = `Anomaly: Collision detected for simulated task (${action.payload.info || ''}).`;
          else outcome = `Simulated Execution optimized successfully for: ${action.payload.info || ''}`;
          status = 'simulated';
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
