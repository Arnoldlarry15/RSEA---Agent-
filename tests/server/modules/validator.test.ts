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

  // ---------------------------------------------------------------------------
  // Null / non-object input
  // ---------------------------------------------------------------------------
  describe('null / non-object action', () => {
    it('rejects null', () => {
      const result = validator.validate(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/null or not an object/i);
    });

    it('rejects undefined', () => {
      const result = validator.validate(undefined);
      expect(result.valid).toBe(false);
    });

    it('rejects a string', () => {
      const result = validator.validate('bad');
      expect(result.valid).toBe(false);
    });

    it('rejects a number', () => {
      const result = validator.validate(42);
      expect(result.valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Missing / invalid tool field
  // ---------------------------------------------------------------------------
  describe('missing or invalid tool field', () => {
    it('rejects an empty tool string', () => {
      const result = validator.validate({ tool: '' });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/missing or invalid tool/i);
    });

    it('rejects when tool field is a number', () => {
      const result = validator.validate({ tool: 42 });
      expect(result.valid).toBe(false);
    });

    it('rejects when tool field is missing entirely', () => {
      const result = validator.validate({ payload: {} });
      expect(result.valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Tool not in whitelist
  // ---------------------------------------------------------------------------
  describe('unlisted tool', () => {
    it('rejects a tool not in the whitelist', () => {
      const result = validator.validate({ tool: 'rm_rf_slash', payload: {} });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/whitelist/i);
    });

    it('rejects an empty string as a tool name', () => {
      const result = validator.validate({ tool: '   ' });
      expect(result.valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // simulate — no required params
  // ---------------------------------------------------------------------------
  describe('simulate tool', () => {
    it('passes without any payload', () => {
      expect(validator.validate({ tool: 'simulate' }).valid).toBe(true);
    });

    it('passes with an arbitrary payload', () => {
      expect(validator.validate({ tool: 'simulate', payload: { info: 'test' } }).valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // api_fetch — requires payload.url
  // ---------------------------------------------------------------------------
  describe('api_fetch tool', () => {
    it('passes when url is provided', () => {
      expect(validator.validate({ tool: 'api_fetch', payload: { url: 'https://example.com' } }).valid).toBe(true);
    });

    it('fails when url is missing', () => {
      const result = validator.validate({ tool: 'api_fetch', payload: {} });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/url/i);
    });

    it('fails when url is null', () => {
      const result = validator.validate({ tool: 'api_fetch', payload: { url: null } });
      expect(result.valid).toBe(false);
    });

    it('fails when payload is absent', () => {
      const result = validator.validate({ tool: 'api_fetch' });
      expect(result.valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // code_eval — requires payload.code
  // ---------------------------------------------------------------------------
  describe('code_eval tool', () => {
    it('passes when code is provided', () => {
      expect(validator.validate({ tool: 'code_eval', payload: { code: 'console.log(1)' } }).valid).toBe(true);
    });

    it('fails when code is missing', () => {
      const result = validator.validate({ tool: 'code_eval', payload: {} });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/code/i);
    });
  });

  // ---------------------------------------------------------------------------
  // system_command — requires payload.command
  // ---------------------------------------------------------------------------
  describe('system_command tool', () => {
    it('passes when command is provided', () => {
      expect(validator.validate({ tool: 'system_command', payload: { command: 'echo hi' } }).valid).toBe(true);
    });

    it('fails when command is missing', () => {
      const result = validator.validate({ tool: 'system_command', payload: {} });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/command/i);
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_send_message — requires threadId and content
  // ---------------------------------------------------------------------------
  describe('moltbook_send_message tool', () => {
    it('passes when both threadId and content are provided', () => {
      const result = validator.validate({ tool: 'moltbook_send_message', payload: { threadId: 't1', content: 'hello' } });
      expect(result.valid).toBe(true);
    });

    it('fails when threadId is missing', () => {
      const result = validator.validate({ tool: 'moltbook_send_message', payload: { content: 'hello' } });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/threadId/i);
    });

    it('fails when content is missing', () => {
      const result = validator.validate({ tool: 'moltbook_send_message', payload: { threadId: 't1' } });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/content/i);
    });

    it('fails when payload is absent', () => {
      const result = validator.validate({ tool: 'moltbook_send_message' });
      expect(result.valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // moltbook_fetch_thread — requires threadId
  // ---------------------------------------------------------------------------
  describe('moltbook_fetch_thread tool', () => {
    it('passes when threadId is provided', () => {
      const result = validator.validate({ tool: 'moltbook_fetch_thread', payload: { threadId: 't1' } });
      expect(result.valid).toBe(true);
    });

    it('fails when threadId is missing', () => {
      const result = validator.validate({ tool: 'moltbook_fetch_thread', payload: {} });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/threadId/i);
    });
  });
});
