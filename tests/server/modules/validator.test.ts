import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolValidator } from '../../../server/modules/validator';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

describe('ToolValidator', () => {
  let validator: ToolValidator;

  beforeEach(() => {
    validator = new ToolValidator();
  });

  // ── Null / non-object actions ───────────────────────────────────────────

  it('rejects null', () => {
    const result = validator.validate(null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('null');
  });

  it('rejects undefined', () => {
    const result = validator.validate(undefined);
    expect(result.valid).toBe(false);
  });

  it('rejects a plain string', () => {
    const result = validator.validate('simulate');
    expect(result.valid).toBe(false);
  });

  it('rejects a number', () => {
    const result = validator.validate(42);
    expect(result.valid).toBe(false);
  });

  // ── Missing / invalid tool field ────────────────────────────────────────

  it('rejects an action with no tool field', () => {
    const result = validator.validate({ payload: {} });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('tool');
  });

  it('rejects an action where tool is not a string', () => {
    const result = validator.validate({ tool: 123, payload: {} });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('tool');
  });

  it('rejects an action where tool is an empty string', () => {
    const result = validator.validate({ tool: '', payload: {} });
    expect(result.valid).toBe(false);
  });

  // ── Unknown tool ────────────────────────────────────────────────────────

  it('rejects a tool not in the whitelist', () => {
    const result = validator.validate({ tool: 'rm_rf', payload: {} });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('whitelist');
  });

  // ── simulate (no required params) ───────────────────────────────────────

  it('accepts a simulate action with any payload', () => {
    const result = validator.validate({ tool: 'simulate', payload: { info: 'test' } });
    expect(result.valid).toBe(true);
  });

  it('accepts a simulate action with an empty payload', () => {
    const result = validator.validate({ tool: 'simulate', payload: {} });
    expect(result.valid).toBe(true);
  });

  // ── api_fetch ────────────────────────────────────────────────────────────

  it('accepts an api_fetch action with a url', () => {
    const result = validator.validate({ tool: 'api_fetch', payload: { url: 'https://example.com' } });
    expect(result.valid).toBe(true);
  });

  it('rejects api_fetch when url is missing', () => {
    const result = validator.validate({ tool: 'api_fetch', payload: {} });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('url');
  });

  it('rejects api_fetch when url is null', () => {
    const result = validator.validate({ tool: 'api_fetch', payload: { url: null } });
    expect(result.valid).toBe(false);
  });

  it('rejects api_fetch when payload is absent', () => {
    const result = validator.validate({ tool: 'api_fetch' });
    expect(result.valid).toBe(false);
  });

  // ── code_eval ────────────────────────────────────────────────────────────

  it('accepts a code_eval action with code', () => {
    const result = validator.validate({ tool: 'code_eval', payload: { code: 'console.log(1)' } });
    expect(result.valid).toBe(true);
  });

  it('rejects code_eval when code is missing', () => {
    const result = validator.validate({ tool: 'code_eval', payload: {} });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('code');
  });

  // ── system_command ───────────────────────────────────────────────────────

  it('accepts a system_command action with command', () => {
    const result = validator.validate({ tool: 'system_command', payload: { command: 'echo hello' } });
    expect(result.valid).toBe(true);
  });

  it('rejects system_command when command is missing', () => {
    const result = validator.validate({ tool: 'system_command', payload: {} });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('command');
  });

  // ── moltbook_send_message ────────────────────────────────────────────────

  it('accepts moltbook_send_message with threadId and content', () => {
    const result = validator.validate({
      tool: 'moltbook_send_message',
      payload: { threadId: 't1', content: 'hello' },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects moltbook_send_message when threadId is missing', () => {
    const result = validator.validate({
      tool: 'moltbook_send_message',
      payload: { content: 'hello' },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('threadId');
  });

  it('rejects moltbook_send_message when content is missing', () => {
    const result = validator.validate({
      tool: 'moltbook_send_message',
      payload: { threadId: 't1' },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('content');
  });

  // ── moltbook_fetch_thread ────────────────────────────────────────────────

  it('accepts moltbook_fetch_thread with threadId', () => {
    const result = validator.validate({
      tool: 'moltbook_fetch_thread',
      payload: { threadId: 't1' },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects moltbook_fetch_thread when threadId is missing', () => {
    const result = validator.validate({
      tool: 'moltbook_fetch_thread',
      payload: {},
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('threadId');
  });
});
