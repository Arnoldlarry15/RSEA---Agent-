import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// ── ingestWebhookEvent tests (no HTTP calls, no BASE_URL needed) ───────────
// These tests use static imports since ingestWebhookEvent is pure logic.

import {
  ingestWebhookEvent,
  setMoltbookToken,
} from '../../../server/adapters/moltbook';

let eventCounter = 0;
/** Return a fresh unique event payload for each test to avoid dedup collisions. */
function makeEvent(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    id: `evt-${++eventCounter}-${Date.now()}`,
    type: 'message',
    content: 'hello',
    ...overrides,
  });
}

describe('ingestWebhookEvent', () => {
  afterEach(() => {
    delete process.env.MOLTBOOK_WEBHOOK_SECRET;
    vi.clearAllMocks();
  });

  it('returns a parsed event for a valid payload without a secret configured', () => {
    const result = ingestWebhookEvent(makeEvent());
    expect(result).not.toBeNull();
    expect(result!.type).toBe('message');
    expect(typeof result!.id).toBe('string');
  });

  it('returns null for malformed JSON', () => {
    const result = ingestWebhookEvent('not-json');
    expect(result).toBeNull();
  });

  it('returns null when the event ID is missing', () => {
    const result = ingestWebhookEvent(JSON.stringify({ type: 'message', content: 'x' }));
    expect(result).toBeNull();
  });

  it('returns null when the event ID is not a string', () => {
    const result = ingestWebhookEvent(JSON.stringify({ id: 42, type: 'message' }));
    expect(result).toBeNull();
  });

  it('returns null for a duplicate event ID', () => {
    const body = makeEvent();
    const first = ingestWebhookEvent(body);
    expect(first).not.toBeNull();
    const second = ingestWebhookEvent(body); // same body → same id
    expect(second).toBeNull();
  });

  it('accepts the event when the correct secret header is supplied', () => {
    process.env.MOLTBOOK_WEBHOOK_SECRET = 'my-secret';
    const result = ingestWebhookEvent(makeEvent(), 'my-secret');
    expect(result).not.toBeNull();
  });

  it('rejects the event when the secret header does not match', () => {
    process.env.MOLTBOOK_WEBHOOK_SECRET = 'my-secret';
    const result = ingestWebhookEvent(makeEvent(), 'wrong-secret');
    expect(result).toBeNull();
  });

  it('rejects the event when the secret is required but the header is omitted', () => {
    process.env.MOLTBOOK_WEBHOOK_SECRET = 'my-secret';
    const result = ingestWebhookEvent(makeEvent());
    expect(result).toBeNull();
  });

  it('allows events with no secret header when MOLTBOOK_WEBHOOK_SECRET is not set', () => {
    delete process.env.MOLTBOOK_WEBHOOK_SECRET;
    const result = ingestWebhookEvent(makeEvent());
    expect(result).not.toBeNull();
  });
});

// ── setMoltbookToken ───────────────────────────────────────────────────────

describe('setMoltbookToken', () => {
  it('is callable without throwing', () => {
    expect(() => setMoltbookToken('new-token-xyz')).not.toThrow();
  });
});

// ── HTTP functions (sendMessage / fetchThread / registerAgent) ─────────────
// These require MOLTBOOK_API_URL to be set, so we use vi.resetModules() and
// dynamic imports to reload the module with the env var in place.

describe('Moltbook HTTP functions', () => {
  beforeEach(() => {
    process.env.MOLTBOOK_API_URL = 'https://moltbook.example.com';
    process.env.MOLTBOOK_API_TOKEN = 'test-token';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MOLTBOOK_API_URL;
    delete process.env.MOLTBOOK_API_TOKEN;
    delete process.env.MOLTBOOK_REFRESH_URL;
    delete process.env.MOLTBOOK_REFRESH_TOKEN;
    vi.clearAllMocks();
  });

  it('sendMessage calls POST /threads/:id/messages and returns the response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ id: 'msg-1', ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { sendMessage } = await import('../../../server/adapters/moltbook');
    const result = await sendMessage('thread-1', 'hello');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('/threads/thread-1/messages');
    expect(calledOpts.method).toBe('POST');
    expect(result).toEqual({ id: 'msg-1', ok: true });
  });

  it('fetchThread calls GET /threads/:id/messages with pagination params', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ messages: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { fetchThread } = await import('../../../server/adapters/moltbook');
    await fetchThread('thread-2', 2, 25);

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('/threads/thread-2/messages');
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('limit=25');
  });

  it('registerAgent calls POST /agents/register', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ registered: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { registerAgent } = await import('../../../server/adapters/moltbook');
    const result = await registerAgent({ name: 'rsea', version: '1.0.0' });

    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('/agents/register');
    expect(calledOpts.method).toBe('POST');
    expect(result).toEqual({ registered: true });
  });

  it('throws when MOLTBOOK_API_URL is not configured', async () => {
    delete process.env.MOLTBOOK_API_URL;
    vi.resetModules();

    const { sendMessage } = await import('../../../server/adapters/moltbook');
    await expect(sendMessage('t', 'msg')).rejects.toThrow('MOLTBOOK_API_URL is not set');
  });

  it('throws an error when the API returns a non-ok status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { sendMessage } = await import('../../../server/adapters/moltbook');
    await expect(sendMessage('t', 'msg')).rejects.toThrow('500');
  });

  it('retries with a refreshed token on a 401 response', async () => {
    process.env.MOLTBOOK_REFRESH_URL = 'https://auth.example.com/refresh';
    process.env.MOLTBOOK_REFRESH_TOKEN = 'refresh-cred';
    vi.resetModules();

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/refresh')) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({ access_token: 'new-token' }),
        });
      }
      callCount++;
      if (callCount === 1) {
        // First call → 401
        return Promise.resolve({ ok: false, status: 401, text: vi.fn().mockResolvedValue('') });
      }
      // Second call (after refresh) → success
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 'msg-ok' }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { sendMessage } = await import('../../../server/adapters/moltbook');
    const result = await sendMessage('thread-auth', 'retry test');
    expect(result).toEqual({ id: 'msg-ok' });
    // Expect 3 fetch calls: original + refresh + retry
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
