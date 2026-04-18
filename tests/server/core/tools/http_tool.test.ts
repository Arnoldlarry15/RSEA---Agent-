import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { HTTPTool } from '../../../../server/core/tools/http_tool';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALLOWED_FETCH_HOSTS;
});

describe('HTTPTool', () => {
  const tool = new HTTPTool();

  it('has name "http_request"', () => {
    expect(tool.name).toBe('http_request');
  });

  it('returns error when url is missing', async () => {
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('url');
    expect(result.confidence).toBe(0);
  });

  it('blocks requests to localhost (SSRF protection)', async () => {
    const result = await tool.execute({ url: 'http://localhost/secret' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SSRF');
  });

  it('blocks requests to private RFC-1918 IPs', async () => {
    for (const url of ['http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/']) {
      const result = await tool.execute({ url });
      expect(result.success).toBe(false);
    }
  });

  it('blocks non-HTTP schemes', async () => {
    const result = await tool.execute({ url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('fetches a URL and returns structured result on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => 'hello',
    }) as any);

    const result = await tool.execute({ url: 'https://example.com' });
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.result.status).toBe(200);
    expect(result.side_effects[0].type).toBe('http_request');
    expect(result.confidence).toBe(1.0);
  });

  it('returns success:false on non-2xx HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'text/plain' },
      text: async () => 'not found',
    }) as any);

    const result = await tool.execute({ url: 'https://example.com/missing' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  it('captures network errors as failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const result = await tool.execute({ url: 'https://fail.example' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('network error');
  });

  it('blocks a host not in ALLOWED_FETCH_HOSTS', async () => {
    process.env.ALLOWED_FETCH_HOSTS = 'api.example.com';
    const result = await tool.execute({ url: 'https://other.example.com/data' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ALLOWED_FETCH_HOSTS');
  });

  it('allows a host present in ALLOWED_FETCH_HOSTS', async () => {
    process.env.ALLOWED_FETCH_HOSTS = 'api.example.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => 'ok',
    }) as any);

    const result = await tool.execute({ url: 'https://api.example.com/v1/data' });
    expect(result.success).toBe(true);
  });

  it('parses JSON response body when content-type is application/json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ key: 'value' }),
    }) as any);

    const result = await tool.execute({ url: 'https://api.example.com/json' });
    expect(result.result.body).toEqual({ key: 'value' });
  });
});
