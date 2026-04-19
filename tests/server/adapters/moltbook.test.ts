import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Reset module state between tests so env vars take effect
vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

describe('Moltbook adapter', () => {
  // We re-import the module inside each test group so env vars are respected.
  // The module uses module-level constants derived from process.env, so we
  // need to reset modules between tests that change env vars.

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MOLTBOOK_API_URL;
    delete process.env.MOLTBOOK_API_TOKEN;
    delete process.env.MOLTBOOK_REFRESH_URL;
    delete process.env.MOLTBOOK_REFRESH_TOKEN;
    delete process.env.MOLTBOOK_WEBHOOK_SECRET;
  });

  // ---------------------------------------------------------------------------
  // ingestWebhookEvent
  // ---------------------------------------------------------------------------
  describe('ingestWebhookEvent', () => {
    it('returns a parsed event for a valid payload', async () => {
      const { ingestWebhookEvent } = await import('../../../server/adapters/moltbook');
      const event = ingestWebhookEvent(JSON.stringify({ id: 'evt-1', type: 'message', content: 'hello' }));
      expect(event).not.toBeNull();
      expect(event!.id).toBe('evt-1');
      expect(event!.type).toBe('message');
    });

    it('returns null for malformed JSON', async () => {
      const { ingestWebhookEvent } = await import('../../../server/adapters/moltbook');
      const event = ingestWebhookEvent('not-json');
      expect(event).toBeNull();
    });

    it('returns null when event.id is missing', async () => {
      const { ingestWebhookEvent } = await import('../../../server/adapters/moltbook');
      const event = ingestWebhookEvent(JSON.stringify({ type: 'message' }));
      expect(event).toBeNull();
    });

    it('deduplicates events with the same id', async () => {
      const { ingestWebhookEvent } = await import('../../../server/adapters/moltbook');
      const payload = JSON.stringify({ id: 'dup-1', type: 'message' });
      const first = ingestWebhookEvent(payload);
      const second = ingestWebhookEvent(payload);
      expect(first).not.toBeNull();
      expect(second).toBeNull(); // duplicate
    });

    it('rejects the event when the secret header does not match', async () => {
      process.env.MOLTBOOK_WEBHOOK_SECRET = 'correct-secret';
      const { ingestWebhookEvent } = await import('../../../server/adapters/moltbook');
      const event = ingestWebhookEvent(
        JSON.stringify({ id: 'evt-bad', type: 'message' }),
        'wrong-secret'
      );
      expect(event).toBeNull();
    });

    it('accepts the event when the secret header matches', async () => {
      process.env.MOLTBOOK_WEBHOOK_SECRET = 'my-secret';
      const { ingestWebhookEvent } = await import('../../../server/adapters/moltbook');
      const event = ingestWebhookEvent(
        JSON.stringify({ id: 'evt-ok', type: 'message' }),
        'my-secret'
      );
      expect(event).not.toBeNull();
    });

    it('accepts the event when no secret is configured (open mode)', async () => {
      delete process.env.MOLTBOOK_WEBHOOK_SECRET;
      const { ingestWebhookEvent } = await import('../../../server/adapters/moltbook');
      const event = ingestWebhookEvent(
        JSON.stringify({ id: 'evt-open', type: 'ping' })
      );
      expect(event).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // setMoltbookToken
  // ---------------------------------------------------------------------------
  describe('setMoltbookToken', () => {
    it('is exported and callable without throwing', async () => {
      const { setMoltbookToken } = await import('../../../server/adapters/moltbook');
      expect(() => setMoltbookToken('new-token')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------
  describe('sendMessage', () => {
    it('throws when MOLTBOOK_API_URL is not configured', async () => {
      delete process.env.MOLTBOOK_API_URL;
      const { sendMessage } = await import('../../../server/adapters/moltbook');
      await expect(sendMessage('thread-1', 'hello')).rejects.toThrow('MOLTBOOK_API_URL is not set');
    });

    it('makes a POST to the messages endpoint and returns the response', async () => {
      process.env.MOLTBOOK_API_URL = 'https://api.moltbook.test';
      process.env.MOLTBOOK_API_TOKEN = 'tok-123';
      const mockResponse = { id: 'msg-1', ok: true };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      }));

      const { sendMessage } = await import('../../../server/adapters/moltbook');
      const result = await sendMessage('thread-abc', 'test content');
      expect(result).toEqual(mockResponse);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/threads/thread-abc/messages');
      expect(fetchCall[1].method).toBe('POST');
    });

    it('auto-refreshes token on 401 and retries', async () => {
      process.env.MOLTBOOK_API_URL = 'https://api.moltbook.test';
      process.env.MOLTBOOK_API_TOKEN = 'expired-token';
      process.env.MOLTBOOK_REFRESH_URL = 'https://api.moltbook.test/refresh';
      process.env.MOLTBOOK_REFRESH_TOKEN = 'refresh-cred';

      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/refresh')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'new-token' }) };
        }
        callCount++;
        if (callCount === 1) {
          // First call: 401
          return { ok: false, status: 401, text: async () => 'Unauthorized' };
        }
        // Second call (after refresh): success
        return { ok: true, status: 200, json: async () => ({ id: 'msg-refreshed' }) };
      }));

      const { sendMessage } = await import('../../../server/adapters/moltbook');
      const result = await sendMessage('thread-1', 'hello');
      expect(result).toEqual({ id: 'msg-refreshed' });
      expect(callCount).toBe(2);
    });

    it('throws on non-401 HTTP errors', async () => {
      process.env.MOLTBOOK_API_URL = 'https://api.moltbook.test';
      process.env.MOLTBOOK_API_TOKEN = 'tok-123';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }));

      const { sendMessage } = await import('../../../server/adapters/moltbook');
      await expect(sendMessage('thread-1', 'content')).rejects.toThrow('500');
    });

    it('throws on network error', async () => {
      process.env.MOLTBOOK_API_URL = 'https://api.moltbook.test';
      process.env.MOLTBOOK_API_TOKEN = 'tok-123';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const { sendMessage } = await import('../../../server/adapters/moltbook');
      await expect(sendMessage('thread-1', 'content')).rejects.toThrow('network error');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchThread
  // ---------------------------------------------------------------------------
  describe('fetchThread', () => {
    it('throws when MOLTBOOK_API_URL is not configured', async () => {
      delete process.env.MOLTBOOK_API_URL;
      const { fetchThread } = await import('../../../server/adapters/moltbook');
      await expect(fetchThread('thread-1')).rejects.toThrow('MOLTBOOK_API_URL is not set');
    });

    it('fetches the thread messages endpoint with default pagination', async () => {
      process.env.MOLTBOOK_API_URL = 'https://api.moltbook.test';
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      const mockMessages = { messages: [{ id: 'm1' }] };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockMessages,
      }));

      const { fetchThread } = await import('../../../server/adapters/moltbook');
      const result = await fetchThread('thread-xyz');
      expect(result).toEqual(mockMessages);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/threads/thread-xyz/messages');
      expect(fetchCall[0]).toContain('page=1');
      expect(fetchCall[0]).toContain('limit=50');
    });

    it('passes custom page and limit parameters', async () => {
      process.env.MOLTBOOK_API_URL = 'https://api.moltbook.test';
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messages: [] }),
      }));

      const { fetchThread } = await import('../../../server/adapters/moltbook');
      await fetchThread('thread-1', 3, 20);

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain('page=3');
      expect(fetchUrl).toContain('limit=20');
    });
  });

  // ---------------------------------------------------------------------------
  // registerAgent
  // ---------------------------------------------------------------------------
  describe('registerAgent', () => {
    it('makes a POST to /agents/register', async () => {
      process.env.MOLTBOOK_API_URL = 'https://api.moltbook.test';
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ registered: true }),
      }));

      const { registerAgent } = await import('../../../server/adapters/moltbook');
      const result = await registerAgent({ name: 'rsea-agent', version: '1.0.0' });
      expect(result).toEqual({ registered: true });

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/agents/register');
      expect(fetchCall[1].method).toBe('POST');
    });
  });
});
