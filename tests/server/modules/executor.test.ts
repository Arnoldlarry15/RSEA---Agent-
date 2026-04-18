import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Executor } from '../../../server/modules/executor';

// Suppress logger output during tests
vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// Mock Moltbook adapter so tests don't need a live API
vi.mock('../../../server/adapters/moltbook', () => ({
  sendMessage: vi.fn().mockResolvedValue({ id: 'msg1', ok: true }),
  fetchThread: vi.fn().mockResolvedValue({ messages: [{ id: 'm1', content: 'hello' }] }),
}));

describe('Executor', () => {
  let executor: Executor;

  beforeEach(() => {
    executor = new Executor();
    delete process.env.ALLOWED_COMMANDS;
    // Disable dry-run mode for all executor tests (safe default is true at runtime)
    process.env.DRY_RUN = 'false';
  });

  afterEach(() => {
    delete process.env.DRY_RUN;
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

    // SSRF protection
    it('blocks requests to localhost', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: { url: 'http://localhost/secret' } }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('blocked');
    });

    it('blocks requests to 127.x loopback addresses', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: { url: 'http://127.0.0.1:8080/internal' } }
      ]);
      expect(results[0].status).toBe('blocked');
    });

    it('blocks requests to RFC-1918 private IP ranges', async () => {
      for (const url of [
        'http://10.0.0.1/admin',
        'http://172.16.0.1/admin',
        'http://192.168.1.1/admin',
      ]) {
        const results = await executor.execute([
          { action: 'strike', tool: 'api_fetch', payload: { url } }
        ]);
        expect(results[0].status).toBe('blocked');
      }
    });

    it('blocks requests to the cloud metadata endpoint', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: { url: 'http://169.254.169.254/latest/meta-data/' } }
      ]);
      expect(results[0].status).toBe('blocked');
    });

    it('blocks non-HTTP(S) schemes', async () => {
      for (const url of ['file:///etc/passwd', 'ftp://internal.host/data']) {
        const results = await executor.execute([
          { action: 'strike', tool: 'api_fetch', payload: { url } }
        ]);
        expect(results[0].status).toBe('blocked');
      }
    });

    it('blocks a host not in ALLOWED_FETCH_HOSTS when the allowlist is set', async () => {
      process.env.ALLOWED_FETCH_HOSTS = 'api.example.com';
      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: { url: 'https://other.example.com/data' } }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('ALLOWED_FETCH_HOSTS');
      delete process.env.ALLOWED_FETCH_HOSTS;
    });

    it('allows a host present in ALLOWED_FETCH_HOSTS', async () => {
      process.env.ALLOWED_FETCH_HOSTS = 'api.example.com';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }) as any);
      const results = await executor.execute([
        { action: 'strike', tool: 'api_fetch', payload: { url: 'https://api.example.com/v1/data' } }
      ]);
      expect(results[0].status).toBe('executed');
      delete process.env.ALLOWED_FETCH_HOSTS;
      vi.unstubAllGlobals();
    });
  });

  // ---------------------------------------------------------------------------
  // code_eval tool
  // ---------------------------------------------------------------------------
  describe('code_eval tool', () => {
    beforeEach(() => {
      // SEC-3: code_eval requires explicit opt-in via ALLOW_CODE_EVAL=true
      process.env.ALLOW_CODE_EVAL = 'true';
    });

    afterEach(() => {
      delete process.env.ALLOW_CODE_EVAL;
    });

    it('is blocked when ALLOW_CODE_EVAL is not set', async () => {
      delete process.env.ALLOW_CODE_EVAL;
      const results = await executor.execute([
        { action: 'strike', tool: 'code_eval', payload: { code: 'console.log("hi")' } }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('ALLOW_CODE_EVAL');
    });

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

    it('rejects code that exceeds the 10 000 character size limit', async () => {
      const bigCode = 'var x = 1;\n'.repeat(1000); // 11 000 chars — above the 10 000 limit
      const results = await executor.execute([
        { action: 'strike', tool: 'code_eval', payload: { code: bigCode } }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('too large');
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

    it('blocks a command when an argument contains unsafe characters', async () => {
      process.env.ALLOWED_COMMANDS = 'echo';
      const results = await executor.execute([
        { action: 'strike', tool: 'system_command', payload: { command: 'echo $(whoami)' } }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('unsafe');
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

  // ---------------------------------------------------------------------------
  // moltbook_send_message tool
  // ---------------------------------------------------------------------------
  describe('moltbook_send_message tool', () => {
    it('sends a message and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_send_message', payload: { threadId: 'thread-1', content: 'hello' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('thread-1');
    });

    it('fails when threadId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_send_message', payload: { content: 'hello' } }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('threadId');
    });

    it('fails when content is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_send_message', payload: { threadId: 'thread-1' } }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('content');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_fetch_thread tool
  // ---------------------------------------------------------------------------
  describe('moltbook_fetch_thread tool', () => {
    it('fetches a thread and returns its content', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_fetch_thread', payload: { threadId: 'thread-1' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('thread-1');
    });

    it('uses custom page and limit parameters when provided', async () => {
      const { fetchThread } = await import('../../../server/adapters/moltbook');
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_fetch_thread', payload: { threadId: 'thread-2', page: 2, limit: 10 } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(fetchThread).toHaveBeenCalledWith('thread-2', 2, 10);
    });

    it('fails when threadId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_fetch_thread', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('threadId');
    });
  });
});
