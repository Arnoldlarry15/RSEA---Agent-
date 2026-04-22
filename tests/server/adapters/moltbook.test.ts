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
    delete process.env.MOLTBOOK_API_TOKEN;
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
  // solveVerificationChallenge
  // ---------------------------------------------------------------------------
  describe('solveVerificationChallenge', () => {
    it('solves a plain "five plus three" challenge', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('What is five plus three?')).toBe(8);
    });

    it('handles obfuscated alternating-caps input', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('WhAt Is FiVe!!! pLuS## tHrEe?')).toBe(8);
    });

    it('solves subtraction', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('ten minus four')).toBe(6);
    });

    it('solves multiplication', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('three times four')).toBe(12);
    });

    it('solves division', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('twelve divided by three')).toBe(4);
    });

    it('solves numeric operands directly', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('7 plus 8')).toBe(15);
    });

    it('returns null for unparseable input', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('what is the meaning of life')).toBeNull();
    });

    it('returns null for division by zero', async () => {
      const { solveVerificationChallenge } = await import('../../../server/adapters/moltbook');
      expect(solveVerificationChallenge('five divided by zero')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // registerAgent
  // ---------------------------------------------------------------------------
  describe('registerAgent', () => {
    it('sends { name, description } to /agents/register and returns the full response', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      const mockResponse = {
        agent: { api_key: 'moltbook_xyz', claim_url: 'https://www.moltbook.com/claim/123', verification_code: 'vc-999' }
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      }));

      const { registerAgent } = await import('../../../server/adapters/moltbook');
      const result = await registerAgent({ name: 'RSEA Agent', description: 'Test agent' });
      expect(result).toEqual(mockResponse);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/agents/register');
      expect(fetchCall[1].method).toBe('POST');

      const sentBody = JSON.parse(fetchCall[1].body);
      expect(sentBody).toHaveProperty('name');
      expect(sentBody).toHaveProperty('description');
      expect(sentBody).not.toHaveProperty('version');
      expect(sentBody).not.toHaveProperty('webhookUrl');
    });
  });

  // ---------------------------------------------------------------------------
  // getHome
  // ---------------------------------------------------------------------------
  describe('getHome', () => {
    it('throws when MOLTBOOK_API_TOKEN is not configured', async () => {
      delete process.env.MOLTBOOK_API_TOKEN;
      const { getHome } = await import('../../../server/adapters/moltbook');
      await expect(getHome()).rejects.toThrow('MOLTBOOK_API_TOKEN is not set');
    });

    it('makes a GET to /home and returns the response', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      const mockHome = { feed: [{ id: 'p1' }] };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockHome,
      }));

      const { getHome } = await import('../../../server/adapters/moltbook');
      const result = await getHome();
      expect(result).toEqual(mockHome);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/home');
      expect(fetchCall[1].method).toBe('GET');
    });

    it('uses the hardcoded www.moltbook.com base URL', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }));

      const { getHome } = await import('../../../server/adapters/moltbook');
      await getHome();

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('www.moltbook.com');
    });
  });

  // ---------------------------------------------------------------------------
  // createPost
  // ---------------------------------------------------------------------------
  describe('createPost', () => {
    it('makes a POST to /posts and returns the response', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      const mockPost = { id: 'p-1', content: 'hello' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockPost,
      }));

      const { createPost } = await import('../../../server/adapters/moltbook');
      const result = await createPost('hello');
      expect(result).toEqual(mockPost);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/posts');
      expect(fetchCall[1].method).toBe('POST');
    });

    it('automatically solves and submits a verification challenge in the response', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) {
          // POST /posts response with a verification challenge
          return {
            ok: true, status: 200,
            json: async () => ({
              id: 'p-1',
              verification: { id: 'v-abc', challenge: 'What is three plus four?' }
            })
          };
        }
        // POST /verify
        return { ok: true, status: 200, json: async () => ({ verified: true }) };
      }));

      const { createPost } = await import('../../../server/adapters/moltbook');
      await createPost('hello');

      expect(callCount).toBe(2);
      const verifyCall = (global.fetch as any).mock.calls[1];
      expect(verifyCall[0]).toContain('/verify');
      const body = JSON.parse(verifyCall[1].body);
      expect(body.id).toBe('v-abc');
      expect(body.answer).toBe(7);
    });

    it('does not submit verification when challenge is unsolvable', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true, status: 200,
          json: async () => ({
            id: 'p-2',
            verification: { id: 'v-xyz', challenge: 'what is the meaning of life' }
          })
        };
      }));

      const { createPost } = await import('../../../server/adapters/moltbook');
      await createPost('hello');

      // Only the POST /posts call — no /verify call since challenge is unsolvable
      expect(callCount).toBe(1);
    });

    it('throws on HTTP errors', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }));

      const { createPost } = await import('../../../server/adapters/moltbook');
      await expect(createPost('hello')).rejects.toThrow('500');
    });
  });

  // ---------------------------------------------------------------------------
  // createComment
  // ---------------------------------------------------------------------------
  describe('createComment', () => {
    it('makes a POST to /posts/{id}/comments', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      const mockComment = { id: 'c-1' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockComment,
      }));

      const { createComment } = await import('../../../server/adapters/moltbook');
      const result = await createComment('post-99', 'great post');
      expect(result).toEqual(mockComment);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/posts/post-99/comments');
      expect(fetchCall[1].method).toBe('POST');
    });
  });

  // ---------------------------------------------------------------------------
  // upvotePost / downvotePost
  // ---------------------------------------------------------------------------
  describe('upvotePost', () => {
    it('makes a POST to /posts/{id}/upvote', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ ok: true }),
      }));

      const { upvotePost } = await import('../../../server/adapters/moltbook');
      await upvotePost('post-5');

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/posts/post-5/upvote');
      expect(fetchCall[1].method).toBe('POST');
    });
  });

  describe('downvotePost', () => {
    it('makes a POST to /posts/{id}/downvote', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ ok: true }),
      }));

      const { downvotePost } = await import('../../../server/adapters/moltbook');
      await downvotePost('post-5');

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/posts/post-5/downvote');
      expect(fetchCall[1].method).toBe('POST');
    });
  });

  // ---------------------------------------------------------------------------
  // getFeed
  // ---------------------------------------------------------------------------
  describe('getFeed', () => {
    it('makes a GET to /feed', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ posts: [] }),
      }));

      const { getFeed } = await import('../../../server/adapters/moltbook');
      const result = await getFeed();
      expect(result).toEqual({ posts: [] });

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/feed');
      expect(fetchCall[1].method).toBe('GET');
    });
  });

  // ---------------------------------------------------------------------------
  // getPostComments
  // ---------------------------------------------------------------------------
  describe('getPostComments', () => {
    it('makes a GET to /posts/{id}/comments', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ comments: [] }),
      }));

      const { getPostComments } = await import('../../../server/adapters/moltbook');
      await getPostComments('post-77');

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/posts/post-77/comments');
      expect(fetchCall[1].method).toBe('GET');
    });
  });

  // ---------------------------------------------------------------------------
  // submitVerification
  // ---------------------------------------------------------------------------
  describe('submitVerification', () => {
    it('makes a POST to /verify with id and answer', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ verified: true }),
      }));

      const { submitVerification } = await import('../../../server/adapters/moltbook');
      await submitVerification('v-123', 42);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/verify');
      expect(fetchCall[1].method).toBe('POST');
      const body = JSON.parse(fetchCall[1].body);
      expect(body.id).toBe('v-123');
      expect(body.answer).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // getAgentStatus
  // ---------------------------------------------------------------------------
  describe('getAgentStatus', () => {
    it('makes a GET to /agents/status', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ status: 'claimed' }),
      }));

      const { getAgentStatus } = await import('../../../server/adapters/moltbook');
      const result = await getAgentStatus();
      expect(result).toEqual({ status: 'claimed' });

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/agents/status');
    });
  });

  // ---------------------------------------------------------------------------
  // markNotificationsRead
  // ---------------------------------------------------------------------------
  describe('markNotificationsRead', () => {
    it('makes a POST to /notifications/read-by-post/{id}', async () => {
      process.env.MOLTBOOK_API_TOKEN = 'tok-abc';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ ok: true }),
      }));

      const { markNotificationsRead } = await import('../../../server/adapters/moltbook');
      await markNotificationsRead('post-42');

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/notifications/read-by-post/post-42');
      expect(fetchCall[1].method).toBe('POST');
    });
  });
});
