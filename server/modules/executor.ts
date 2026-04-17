import vm from 'vm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logEvent } from '../utils/logger';

const execFileAsync = promisify(execFile);

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
          const res = await fetch(action.payload.url, action.payload.options || {});
          outcome = `API Call completed with status ${res.status}`;
        } else if (action.tool === 'code_eval') {
          const code: string = action.payload?.code ?? '';
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
