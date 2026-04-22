import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Executor, _simulateRng } from '../../../server/modules/executor';

// Suppress logger output during tests
vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// Mock Moltbook adapter so tests don't need a live API
vi.mock('../../../server/adapters/moltbook', () => ({
  createPost: vi.fn().mockResolvedValue({ id: 'post-1', ok: true }),
  createComment: vi.fn().mockResolvedValue({ id: 'comment-1', ok: true }),
  upvotePost: vi.fn().mockResolvedValue({ ok: true }),
  downvotePost: vi.fn().mockResolvedValue({ ok: true }),
  getHome: vi.fn().mockResolvedValue({ feed: [] }),
  getFeed: vi.fn().mockResolvedValue({ posts: [] }),
  getPostComments: vi.fn().mockResolvedValue({ comments: [] }),
  submitVerification: vi.fn().mockResolvedValue({ verified: true }),
  getAgentStatus: vi.fn().mockResolvedValue({ status: 'active' }),
  markNotificationsRead: vi.fn().mockResolvedValue({ ok: true }),
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
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5); // Not > 0.95 → success
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'test task' } }
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('simulated');
      expect(results[0].outcome).toContain('optimized successfully');
      vi.restoreAllMocks();
    });

    it('returns an Anomaly outcome when luck > 0.95', async () => {
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.99);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'anomaly task' } }
      ]);
      expect(results[0].outcome).toContain('Anomaly');
      vi.restoreAllMocks();
    });

    it('returns a deterministic outcome for the same payload info', async () => {
      const results1 = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'deterministic-task-abc' } }
      ]);
      const results2 = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'deterministic-task-abc' } }
      ]);
      expect(results1[0].outcome).toBe(results2[0].outcome);
      expect(results1[0].status).toBe(results2[0].status);
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

    it('blocks code that contains a sandbox-escape pattern (G7)', async () => {
      for (const dangerousCode of [
        'process.exit(1)',
        'require("fs")',
        'this.constructor["prototype"]',
        'globalThis.x = 1',
      ]) {
        const results = await executor.execute([
          { action: 'strike', tool: 'code_eval', payload: { code: dangerousCode } }
        ]);
        expect(results[0].status).toBe('blocked');
        expect(results[0].outcome).toContain('blocked');
      }
    });

    it('allows safe code that does not match any escape pattern', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'code_eval', payload: { code: 'console.log("safe code")' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('safe code');
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
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'priority_alert', tool: 'simulate', payload: { info: '' } }
      ]);
      expect(results[0].priority).toBe('CRITICAL');
      vi.restoreAllMocks();
    });

    it('marks priority "STANDARD" for non-alert actions', async () => {
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'surgical_strike', tool: 'simulate', payload: { info: '' } }
      ]);
      expect(results[0].priority).toBe('STANDARD');
      vi.restoreAllMocks();
    });

    it('includes a timestamp on each result', async () => {
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: '' } }
      ]);
      expect(typeof results[0].timestamp).toBe('string');
      vi.restoreAllMocks();
    });

    it('processes multiple actions and returns one result per action', async () => {
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'a' } },
        { action: 'strike', tool: 'simulate', payload: { info: 'b' } },
      ]);
      expect(results).toHaveLength(2);
      vi.restoreAllMocks();
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_create_post tool
  // ---------------------------------------------------------------------------
  describe('moltbook_create_post tool', () => {
    it('creates a post and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_create_post', payload: { content: 'hello world' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('post');
    });

    it('fails when content is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_create_post', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
      expect(results[0].outcome).toContain('content');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_create_comment tool
  // ---------------------------------------------------------------------------
  describe('moltbook_create_comment tool', () => {
    it('creates a comment and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_create_comment', payload: { postId: 'post-1', content: 'nice post' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('post-1');
    });

    it('fails when postId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_create_comment', payload: { content: 'nice post' } }
      ]);
      expect(results[0].status).toBe('failed');
    });

    it('fails when content is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_create_comment', payload: { postId: 'post-1' } }
      ]);
      expect(results[0].status).toBe('failed');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_upvote / moltbook_downvote tools
  // ---------------------------------------------------------------------------
  describe('moltbook_upvote tool', () => {
    it('upvotes a post and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_upvote', payload: { postId: 'post-1' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('post-1');
    });

    it('fails when postId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_upvote', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
    });
  });

  describe('moltbook_downvote tool', () => {
    it('downvotes a post and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_downvote', payload: { postId: 'post-1' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('post-1');
    });

    it('fails when postId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_downvote', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_get_home tool
  // ---------------------------------------------------------------------------
  describe('moltbook_get_home tool', () => {
    it('fetches home dashboard and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_get_home', payload: {} }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('home');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_get_feed tool
  // ---------------------------------------------------------------------------
  describe('moltbook_get_feed tool', () => {
    it('fetches feed and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_get_feed', payload: {} }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('feed');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_get_post_comments tool
  // ---------------------------------------------------------------------------
  describe('moltbook_get_post_comments tool', () => {
    it('fetches comments for a post and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_get_post_comments', payload: { postId: 'post-1' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('post-1');
    });

    it('fails when postId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_get_post_comments', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_submit_verification tool
  // ---------------------------------------------------------------------------
  describe('moltbook_submit_verification tool', () => {
    it('submits a verification answer and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_submit_verification', payload: { verificationId: 'v-1', answer: 8 } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('v-1');
    });

    it('fails when verificationId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_submit_verification', payload: { answer: 8 } }
      ]);
      expect(results[0].status).toBe('failed');
    });

    it('fails when answer is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_submit_verification', payload: { verificationId: 'v-1' } }
      ]);
      expect(results[0].status).toBe('failed');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_get_agent_status tool
  // ---------------------------------------------------------------------------
  describe('moltbook_get_agent_status tool', () => {
    it('fetches agent status and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_get_agent_status', payload: {} }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('status');
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_mark_notifications_read tool
  // ---------------------------------------------------------------------------
  describe('moltbook_mark_notifications_read tool', () => {
    it('marks notifications read for a post and reports success', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_mark_notifications_read', payload: { postId: 'post-1' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].outcome).toContain('post-1');
    });

    it('fails when postId is missing', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'moltbook_mark_notifications_read', payload: {} }
      ]);
      expect(results[0].status).toBe('failed');
    });
  });

  // ---------------------------------------------------------------------------
  // Extended result shape (new fields)
  // ---------------------------------------------------------------------------
  describe('extended result shape', () => {
    it('legacy tools include success, error, side_effects, confidence fields', async () => {
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'x' } }
      ]);
      expect(results[0]).toHaveProperty('success');
      expect(results[0]).toHaveProperty('error');
      expect(results[0]).toHaveProperty('side_effects');
      expect(results[0]).toHaveProperty('confidence');
      expect(results[0].success).toBe(true);
      vi.restoreAllMocks();
    });

    it('failed legacy tools have success:false and non-null error', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'nonexistent_tool', payload: {} }
      ]);
      expect(results[0].success).toBe(false);
      expect(results[0].error).not.toBeNull();
    });

    it('dry-run results include the new fields', async () => {
      process.env.DRY_RUN = 'true';
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: '' } }
      ]);
      expect(results[0].status).toBe('dry_run');
      expect(results[0]).toHaveProperty('success');
      expect(results[0]).toHaveProperty('side_effects');
      delete process.env.DRY_RUN;
    });
  });

  // ---------------------------------------------------------------------------
  // ExecutionConstraints
  // ---------------------------------------------------------------------------
  describe('ExecutionConstraints', () => {
    it('blocks a tool not in constraints.allowedTools', async () => {
      const results = await executor.execute(
        [{ action: 'strike', tool: 'simulate', payload: { info: '' } }],
        { allowedTools: ['api_fetch'] }
      );
      expect(results[0].status).toBe('blocked');
      expect(results[0].success).toBe(false);
    });

    it('allows a tool present in constraints.allowedTools', async () => {
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute(
        [{ action: 'strike', tool: 'simulate', payload: { info: '' } }],
        { allowedTools: ['simulate'] }
      );
      expect(results[0].status).toBe('simulated');
      vi.restoreAllMocks();
    });

    it('constraints.dryRun=true overrides DRY_RUN env', async () => {
      process.env.DRY_RUN = 'false';
      const results = await executor.execute(
        [{ action: 'strike', tool: 'simulate', payload: { info: '' } }],
        { dryRun: true }
      );
      expect(results[0].status).toBe('dry_run');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool registry integration (http_request / file_read / file_write / webhook)
  // ---------------------------------------------------------------------------
  describe('registry tool dispatch', () => {
    it('dispatches http_request to HTTPTool and returns structured output', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/plain' },
        text: async () => 'response body',
      }) as any);

      const results = await executor.execute([
        { action: 'strike', tool: 'http_request', payload: { url: 'https://api.example.com/data' } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].success).toBe(true);
      expect(results[0].result.status).toBe(200);
      expect(results[0].side_effects[0].type).toBe('http_request');
      vi.unstubAllGlobals();
    });

    it('http_request returns blocked-like failure on SSRF target', async () => {
      const results = await executor.execute([
        { action: 'strike', tool: 'http_request', payload: { url: 'http://localhost/secret' } }
      ]);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('SSRF');
    });

    it('dispatches webhook to WebhookTool and returns structured output', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any);
      const results = await executor.execute([
        { action: 'strike', tool: 'webhook', payload: { url: 'https://hooks.example.com/signal', payload: { msg: 'hi' } } }
      ]);
      expect(results[0].status).toBe('executed');
      expect(results[0].success).toBe(true);
      expect(results[0].side_effects[0].type).toBe('webhook_sent');
      vi.unstubAllGlobals();
    });

    it('dispatches file_write + file_read via registry', async () => {
      const writeResults = await executor.execute([
        { action: 'strike', tool: 'file_write', payload: { path: '_executor_test.txt', content: 'hello registry' } }
      ]);
      expect(writeResults[0].status).toBe('executed');
      expect(writeResults[0].success).toBe(true);

      const readResults = await executor.execute([
        { action: 'strike', tool: 'file_read', payload: { path: '_executor_test.txt' } }
      ]);
      expect(readResults[0].status).toBe('executed');
      expect(readResults[0].result).toBe('hello registry');

      // cleanup
      const f = path.join(process.cwd(), 'data', '_executor_test.txt');
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  });

  // ---------------------------------------------------------------------------
  // RulesEngine constraint gate (validate() integration)
  // ---------------------------------------------------------------------------
  describe('RulesEngine constraint gate', () => {
    afterEach(() => {
      delete process.env.MAX_ACTIONS_PER_CYCLE;
      delete process.env.RISK_THRESHOLD;
      delete process.env.ACTION_TIMEOUT_MS;
      delete process.env.RULE_ALLOWED_TOOLS;
    });

    it('blocks an action whose risk exceeds RISK_THRESHOLD', async () => {
      process.env.RISK_THRESHOLD = '50';
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'risky' }, risk: 75 }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('risk score');
      expect(results[0].success).toBe(false);
    });

    it('allows an action whose risk is at or below RISK_THRESHOLD', async () => {
      process.env.RISK_THRESHOLD = '50';
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'safe' }, risk: 50 }
      ]);
      expect(results[0].status).toBe('simulated');
      vi.restoreAllMocks();
    });

    it('blocks an action when the per-cycle action count is exhausted', async () => {
      process.env.MAX_ACTIONS_PER_CYCLE = '1';
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'first' } },
        { action: 'strike', tool: 'simulate', payload: { info: 'second' } },
      ]);
      expect(results[0].status).toBe('simulated');
      expect(results[1].status).toBe('blocked');
      expect(results[1].outcome).toContain('Cycle action limit');
      vi.restoreAllMocks();
    });

    it('resets the per-cycle counter between execute() calls', async () => {
      process.env.MAX_ACTIONS_PER_CYCLE = '1';
      vi.spyOn(_simulateRng, 'getLuck').mockReturnValue(0.5);
      const first = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'a' } }
      ]);
      const second = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: { info: 'b' } }
      ]);
      expect(first[0].status).toBe('simulated');
      expect(second[0].status).toBe('simulated');
      vi.restoreAllMocks();
    });

    it('blocks a tool not in RULE_ALLOWED_TOOLS', async () => {
      process.env.RULE_ALLOWED_TOOLS = 'api_fetch';
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: {} }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('RULE_ALLOWED_TOOLS');
    });

    it('blocks an action whose timeout exceeds ACTION_TIMEOUT_MS', async () => {
      process.env.ACTION_TIMEOUT_MS = '2000';
      const results = await executor.execute([
        { action: 'strike', tool: 'simulate', payload: {}, timeout: 9999 }
      ]);
      expect(results[0].status).toBe('blocked');
      expect(results[0].outcome).toContain('timeout');
    });
  });
});
