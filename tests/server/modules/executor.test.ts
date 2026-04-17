import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Executor } from '../../../server/modules/executor';

// Suppress logger output during tests
vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

describe('Executor', () => {
  let executor: Executor;

  beforeEach(() => {
    executor = new Executor();
    delete process.env.ALLOWED_COMMANDS;
  });

  // ---------------------------------------------------------------------------
  // simulate tool
  // ---------------------------------------------------------------------------
  describe('simulate tool', () => {
    it('returns status "simulated" and a success outcome', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5); // Not > 0.95 → success
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'test task' } }
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('simulated');
      expect(results[0].outcome).toContain('optimized successfully');
      vi.restoreAllMocks();
    });

    it('returns an Anomaly outcome when Math.random() > 0.95', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'anomaly task' } }
      ]);
      expect(results[0].outcome).toContain('Anomaly');
      vi.restoreAllMocks();
    });
  });

  // ---------------------------------------------------------------------------
  // unknown tool
  // ---------------------------------------------------------------------------
  describe('unknown tool', () => {
    it('returns status "failed" for an unrecognised tool', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'nonexistent_tool', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('Unknown tool');
    });
  });

  // ---------------------------------------------------------------------------
  // api_fetch tool
  // ---------------------------------------------------------------------------
  describe('api_fetch tool', () => {
    it('throws an error when no URL is provided', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('Missing URL');
    });

    it('fetches the URL and reports the HTTP status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200 }) as any;
      vi.stubGlobal('fetch', mockFetch);

      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: { url: 'https://example.com' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('200');
      vi.unstubAllGlobals();
    });

    it('handles a fetch error and returns status "failed"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: { url: 'https://fail.example' } }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('network error');
      vi.unstubAllGlobals();
    });
  });

  // ---------------------------------------------------------------------------
  // code_eval tool
  // ---------------------------------------------------------------------------
  describe('code_eval tool', () => {
    it('captures console.log output from sandboxed code', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'code_eval', payload: { code: 'console.log("hello world")' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('hello world');
    });

    it('returns "(no output)" when sandboxed code produces nothing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'code_eval', payload: { code: 'var x = 1 + 1;' } }
      ]);
      expect(results[0].outcome).toBe('(no output)');
    });

    it('handles code that throws and returns status "failed"', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'code_eval', payload: { code: 'throw new Error("boom")' } }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('boom');
    });
  });

  // ---------------------------------------------------------------------------
  // system_command tool
  // ---------------------------------------------------------------------------
  describe('system_command tool', () => {
    it('blocks a command not in the ALLOWED_COMMANDS list', async () => {
      process.env.ALLOWED_COMMANDS = 'ls,echo';
      const results = await executor.execute([
        { action: 'strike', tool: 'system_command', payload: { command: 'rm -rf /' } }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('not permitted');
    });

    it('blocks all commands when ALLOWED_COMMANDS is unset', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'system_command', payload: { command: 'echo hello' } }
      ]);
      expect(results[0].status).toBe('blocked');
    });

    it('executes an allowed command and returns its stdout', async () => {
      process.env.ALLOWED_COMMANDS = 'echo';
      const results = await executor.execute([
        { action: 'strike', tool: 'system_command', payload: { command: 'echo hello' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('hello');
    });
  });

  // ---------------------------------------------------------------------------
  // Result shape
  // ---------------------------------------------------------------------------
  describe('result shape', () => {
    it('marks priority "CRITICAL" for priority_alert actions', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'priority_alert', tool: 'simulate', payload: { info: '' } }
      ]);
      expect(results[0].priority).toBe('CRITICAL');
      vi.restoreAllMocks();
    });

    it('marks priority "STANDARD" for non-alert actions', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'surgical_strike', tool: 'simulate', payload: { info: '' } }
      ]);
      expect(results[0].priority).toBe('STANDARD');
      vi.restoreAllMocks();
    });

    it('includes a timestamp on each result', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: '' } }
      ]);
      expect(typeof results[0].timestamp).toBe('string');
      vi.restoreAllMocks();
    });

    it('processes multiple actions and returns one result per action', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'a' } },
        { action: 'strike', tool: 'simulate', payload: { info: 'b' } },
      ]);
      expect(results).toHaveLength(2);
      vi.restoreAllMocks();
    });
  });
});
