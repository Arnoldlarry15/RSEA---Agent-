import { BaseTool, ToolResult } from './base_tool';
import { isSsrfTargetAsync } from '../../utils/ssrf';

/** Outbound HTTP request timeout in milliseconds (default: 10 s). */
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '10000', 10);

/**
 * Makes outbound HTTP API calls to external services.
 * Enforces SSRF protection (including DNS-rebinding check) and optional host
 * allowlist via ALLOWED_FETCH_HOSTS.
 */
export class HTTPTool extends BaseTool {
  readonly name = 'http_request';
  readonly description = 'Make HTTP API calls to external services';

  async execute(input_data: Record<string, any>): Promise<ToolResult> {
    const { url, method = 'GET', headers = {}, body } = input_data;

    if (!url || typeof url !== 'string') {
      return { result: null, success: false, error: 'Missing required parameter: url', side_effects: [], confidence: 0 };
    }

    if (await isSsrfTargetAsync(url)) {
      return { result: null, success: false, error: `Request to '${url}' was blocked (SSRF protection)`, side_effects: [], confidence: 0 };
    }

    const allowedHosts = (process.env.ALLOWED_FETCH_HOSTS ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (allowedHosts.length > 0) {
      const parsed = new URL(url);
      if (!allowedHosts.includes(parsed.hostname)) {
        return { result: null, success: false, error: `Host '${parsed.hostname}' is not in ALLOWED_FETCH_HOSTS`, side_effects: [], confidence: 0 };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const options: RequestInit = { method: String(method).toUpperCase(), headers, signal: controller.signal };
      if (body !== undefined) {
        options.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const res = await fetch(url, options);
      let responseBody: any;
      const contentType = res.headers.get('content-type') ?? '';
      try {
        responseBody = contentType.includes('application/json')
          ? await res.json()
          : await res.text();
      } catch {
        responseBody = null;
      }

      return {
        result: { status: res.status, body: responseBody },
        success: res.ok,
        error: res.ok ? null : `HTTP ${res.status}`,
        side_effects: [{ type: 'http_request', url, method: options.method, status: res.status }],
        confidence: 1.0,
      };
    } catch (err: any) {
      return { result: null, success: false, error: err.message, side_effects: [], confidence: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}
