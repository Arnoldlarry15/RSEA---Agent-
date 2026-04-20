/**
 * Integration tests — real Executor under DRY_RUN=true and DRY_RUN=false
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses the real Executor (not mocked) to exercise the actual tool dispatch,
 * RulesEngine validation, SSRF guard, and DRY_RUN gate.
 *
 * DRY_RUN semantics:
 *   - DRY_RUN=true  → executor logs every action and returns status 'dry_run'
 *                      AFTER passing RulesEngine validation.
 *   - DRY_RUN=false → actual tool logic runs.  Security checks execute.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Executor } from '../../server/modules/executor';

vi.mock('../../server/utils/logger', () => ({ logEvent: vi.fn() }));
vi.mock('../../server/adapters/moltbook', () => ({
  sendMessage: vi.fn().mockResolvedValue({ id: 'msg1', ok: true }),
  fetchThread: vi.fn().mockResolvedValue({ messages: [] }),
}));

describe('Integration: real Executor', () => {
  let executor: Executor;

  beforeEach(() => {
    process.env.DRY_RUN = 'true';
    delete process.env.ALLOWED_COMMANDS;
    delete process.env.ALLOW_CODE_EVAL;
    executor = new Executor();
  });

  afterEach(() => {
    delete process.env.DRY_RUN;
    delete process.env.ALLOWED_COMMANDS;
    delete process.env.ALLOW_CODE_EVAL;
  });

  it('1. DRY_RUN=true: simulate action returns dry_run (tool logic not reached)', async () => {
    const results = await executor.execute([
      { action: 'test', tool: 'simulate', payload: { info: 'dry-run integration test' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('dry_run');
    expect(results[0].outcome).toContain('DRY RUN');
  });

  it('2. DRY_RUN=true: api_fetch action returns dry_run (no HTTP call made)', async () => {
    const results = await executor.execute([
      { action: 'fetch', tool: 'api_fetch', payload: { url: 'https://httpbin.org/get' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('dry_run');
  });

  it('3. DRY_RUN=true: RulesEngine-blocked action returns blocked before dry_run gate', async () => {
    const results = await executor.execute([
      { action: 'risky', tool: 'simulate', payload: {}, risk: 999 },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('blocked');
  });

  it('4. DRY_RUN=false: SSRF guard blocks requests to private IP addresses', async () => {
    process.env.DRY_RUN = 'false';
    const results = await executor.execute([
      { action: 'fetch', tool: 'api_fetch', payload: { url: 'http://192.168.1.1/sensitive' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('blocked');
    expect(results[0].outcome).toMatch(/blocked/i);
  });

  it('5. DRY_RUN=false: code_eval blocked when ALLOW_CODE_EVAL is false', async () => {
    process.env.DRY_RUN = 'false';
    process.env.ALLOW_CODE_EVAL = 'false';
    const results = await executor.execute([
      { action: 'eval', tool: 'code_eval', payload: { code: '1 + 1' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('blocked');
    expect(results[0].outcome).toMatch(/ALLOW_CODE_EVAL/i);
  });

  it('6. DRY_RUN=false: system_command blocked when ALLOWED_COMMANDS is empty', async () => {
    process.env.DRY_RUN = 'false';
    const results = await executor.execute([
      { action: 'cmd', tool: 'system_command', payload: { command: 'echo', args: ['hello'] } },
    ]);
    expect(results).toHaveLength(1);
    expect(['failed', 'blocked']).toContain(results[0].status);
    expect(results[0].outcome).toMatch(/not in ALLOWED_COMMANDS allowlist/i);
  });

  it('7. DRY_RUN=false: unknown tool returns failed status', async () => {
    process.env.DRY_RUN = 'false';
    const results = await executor.execute([
      { action: 'do_thing', tool: 'nonexistent_tool_xyz', payload: {} },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].outcome).toContain('Unknown tool');
  });

  it('8. DRY_RUN=true: multiple actions all return dry_run', async () => {
    const actions = [
      { action: 'a1', tool: 'simulate', payload: { info: 'task 1' } },
      { action: 'a2', tool: 'simulate', payload: { info: 'task 2' } },
      { action: 'a3', tool: 'simulate', payload: { info: 'task 3' } },
    ];
    const results = await executor.execute(actions);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.status).toBe('dry_run');
    }
  });
});
