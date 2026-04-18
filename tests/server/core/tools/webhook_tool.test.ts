import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebhookTool } from '../../../../server/core/tools/webhook_tool';

const tool = new WebhookTool();

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALLOWED_FETCH_HOSTS;
});

describe('WebhookTool', () => {

  it('has name "webhook"', () => {
    expect(tool.name).toBe('webhook');
  });

  it('returns error when url is missing', async () => {
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('url');
    expect(result.confidence).toBe(0);
  });

  it('blocks requests to localhost (SSRF protection)', async () => {
    const result = await tool.execute({ url: 'http://localhost/hook' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SSRF');
  });

  it('blocks non-HTTP schemes', async () => {
    const result = await tool.execute({ url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('sends a POST webhook and returns structured result on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any);

    const result = await tool.execute({ url: 'https://hooks.example.com/signal', payload: { event: 'test' } });
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.result.status).toBe(200);
    expect(result.side_effects[0].type).toBe('webhook_sent');
    expect(result.confidence).toBe(1.0);
  });

  it('returns success:false on non-2xx HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any);

    const result = await tool.execute({ url: 'https://hooks.example.com/signal' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  it('captures network errors as failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const result = await tool.execute({ url: 'https://hooks.example.com/signal' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('connection refused');
  });

  it('blocks a host not in ALLOWED_FETCH_HOSTS', async () => {
    process.env.ALLOWED_FETCH_HOSTS = 'hooks.trusted.com';
    const result = await tool.execute({ url: 'https://hooks.untrusted.com/signal' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ALLOWED_FETCH_HOSTS');
  });

  it('allows a host present in ALLOWED_FETCH_HOSTS', async () => {
    process.env.ALLOWED_FETCH_HOSTS = 'hooks.trusted.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any);
    const result = await tool.execute({ url: 'https://hooks.trusted.com/signal' });
    expect(result.success).toBe(true);
  });

  it('sends payload as JSON body when payload is an object', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    vi.stubGlobal('fetch', mockFetch);

    await tool.execute({ url: 'https://hooks.example.com/signal', payload: { key: 'val' } });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.example.com/signal',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ key: 'val' }) })
    );
  });
});
