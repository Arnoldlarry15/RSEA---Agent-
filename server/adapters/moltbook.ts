/**
 * Moltbook Adapter
 * ─────────────────
 * Handles all communication with the Moltbook messaging platform:
 *   • API authentication (Bearer token + optional refresh)
 *   • Sending messages to a thread
 *   • Fetching thread/conversation history
 *   • Incoming webhook event ingestion with idempotency deduplication
 *
 * Configuration (via environment variables):
 *   MOLTBOOK_API_URL      – Base URL of the Moltbook API  (required)
 *   MOLTBOOK_API_TOKEN    – Initial Bearer token          (required)
 *   MOLTBOOK_REFRESH_URL  – Token-refresh endpoint        (optional; enables auto-refresh)
 *   MOLTBOOK_REFRESH_TOKEN– Refresh credential            (optional)
 *   MOLTBOOK_WEBHOOK_SECRET – Expected webhook secret header value (optional)
 *   FETCH_TIMEOUT_MS      – Per-request timeout in ms (default 10 000)
 */

import { logEvent } from '../utils/logger';

const BASE_URL = (process.env.MOLTBOOK_API_URL ?? '').replace(/\/$/, '');
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '10000', 10);

// ── Token management ──────────────────────────────────────────────────────────

let currentToken: string = process.env.MOLTBOOK_API_TOKEN ?? '';
/** Guard flag to prevent concurrent token-refresh races. */
let refreshInProgress = false;

/** Replace the in-memory Bearer token (e.g. after a refresh). */
export function setMoltbookToken(token: string) {
  currentToken = token;
}

/** Attempt to refresh the access token using the configured refresh URL. */
async function refreshToken(): Promise<void> {
  if (refreshInProgress) return; // Skip if a refresh is already in flight
  const refreshUrl = process.env.MOLTBOOK_REFRESH_URL;
  const refreshCredential = process.env.MOLTBOOK_REFRESH_TOKEN;
  if (!refreshUrl || !refreshCredential) return;

  refreshInProgress = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshCredential }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Token refresh failed: HTTP ${res.status}`);
    const data = await res.json() as any;
    if (data.access_token) {
      currentToken = data.access_token;
      logEvent('moltbook_token_refreshed', { ok: true });
    }
  } finally {
    clearTimeout(timer);
    refreshInProgress = false;
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface MoltbookRequestOptions {
  method?: string;
  body?: any;
  retryOnUnauthorized?: boolean;
}

async function moltbookRequest(path: string, opts: MoltbookRequestOptions = {}): Promise<any> {
  if (!BASE_URL) {
    logEvent('moltbook_error', { reason: 'MOLTBOOK_API_URL not configured', path });
    throw new Error('Moltbook adapter: MOLTBOOK_API_URL is not set');
  }

  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // Auto-refresh on 401 and retry once
  if (res.status === 401 && opts.retryOnUnauthorized !== false) {
    logEvent('moltbook_auth_retry', { path });
    await refreshToken();
    return moltbookRequest(path, { ...opts, retryOnUnauthorized: false });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Moltbook API error ${res.status}: ${body}`);
    logEvent('moltbook_error', { status: res.status, path, body });
    throw err;
  }

  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Send a message to a Moltbook thread. */
export async function sendMessage(threadId: string, content: string): Promise<any> {
  logEvent('moltbook_send_message', { threadId, contentLength: content.length });
  return moltbookRequest(`/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: { content },
  });
}

/** Fetch a thread's message history (paginated; returns first page by default). */
export async function fetchThread(threadId: string, page = 1, limit = 50): Promise<any> {
  logEvent('moltbook_fetch_thread', { threadId, page, limit });
  return moltbookRequest(
    `/threads/${encodeURIComponent(threadId)}/messages?page=${page}&limit=${limit}`
  );
}

/** Register this agent with Moltbook (optional; call once at startup if needed). */
export async function registerAgent(agentMeta: Record<string, any>): Promise<any> {
  logEvent('moltbook_register_agent', { agentMeta });
  return moltbookRequest('/agents/register', { method: 'POST', body: agentMeta });
}

// ── Webhook ingestion with idempotency ────────────────────────────────────────

/** Set of already-processed event IDs — prevents double-processing. */
const processedEventIds = new Set<string>();
/** Cap the in-memory dedup set to avoid unbounded growth. */
const MAX_PROCESSED_IDS = 10_000;

export interface MoltbookWebhookEvent {
  id: string;
  type: string;
  threadId?: string;
  senderId?: string;
  content?: string;
  timestamp?: string;
  [key: string]: any;
}

/**
 * Validate and ingest a raw webhook payload from Moltbook.
 *
 * @param rawBody – The unparsed JSON string received in the HTTP request body.
 * @param secretHeader – The value of the `X-Moltbook-Secret` header (optional).
 * @returns The parsed event if it should be processed, or `null` if it is a
 *          duplicate or fails validation.
 */
export function ingestWebhookEvent(
  rawBody: string,
  secretHeader?: string
): MoltbookWebhookEvent | null {
  // Optional secret validation
  const expectedSecret = process.env.MOLTBOOK_WEBHOOK_SECRET;
  if (expectedSecret && secretHeader !== expectedSecret) {
    logEvent('moltbook_webhook_rejected', { reason: 'invalid_secret' });
    return null;
  }

  let event: MoltbookWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    logEvent('moltbook_webhook_rejected', { reason: 'malformed_json' });
    return null;
  }

  if (!event.id || typeof event.id !== 'string') {
    logEvent('moltbook_webhook_rejected', { reason: 'missing_event_id' });
    return null;
  }

  // Idempotency: discard duplicates
  if (processedEventIds.has(event.id)) {
    logEvent('moltbook_webhook_duplicate', { eventId: event.id });
    return null;
  }

  // Prune oldest entries when the cap is reached
  if (processedEventIds.size >= MAX_PROCESSED_IDS) {
    const oldest = processedEventIds.values().next().value;
    if (oldest !== undefined) processedEventIds.delete(oldest);
  }
  processedEventIds.add(event.id);

  logEvent('moltbook_webhook_received', { eventId: event.id, type: event.type });
  return event;
}
