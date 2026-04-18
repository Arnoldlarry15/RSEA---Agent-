import { BaseTool, ToolResult } from './base_tool';
import { isSsrfTarget } from '../../utils/ssrf';

/** Outbound webhook request timeout in milliseconds (default: 10 s). */
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '10000', 10);

/**
 * Sends an outbound POST webhook signal to an external service.
 * Enforces SSRF protection and optional host allowlist via ALLOWED_FETCH_HOSTS.
 */
export class WebhookTool extends BaseTool {
  readonly name = 'webhook';
  readonly description = 'Send outbound POST webhook signals to external services';

  async execute(input_data: Record<string, any>): Promise<ToolResult> {
    const { url, payload, headers = {} } = input_data;

    if (!url || typeof url !== 'string') {
      return { result: null, success: false, error: 'Missing required parameter: url', side_effects: [], confidence: 0 };
    }

    if (isSsrfTarget(url)) {
      return { result: null, success: false, error: `Webhook to '${url}' was blocked (SSRF protection)`, side_effects: [], confidence: 0 };
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
      const body = payload !== undefined
        ? (typeof payload === 'string' ? payload : JSON.stringify(payload))
        : undefined;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
        signal: controller.signal,
      });

      return {
        result: { status: res.status },
        success: res.ok,
        error: res.ok ? null : `HTTP ${res.status}`,
        side_effects: [{ type: 'webhook_sent', url, status: res.status }],
        confidence: 1.0,
      };
    } catch (err: any) {
      return { result: null, success: false, error: err.message, side_effects: [], confidence: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}
