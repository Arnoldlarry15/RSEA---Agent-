/**
 * Moltbook Adapter
 * ─────────────────
 * Handles all communication with the Moltbook social network API (v1):
 *   • API authentication (static API key — moltbook_xxx — no OAuth refresh)
 *   • Social operations: posts, comments, upvotes, feed, home dashboard
 *   • Verification challenge solver (math word problems)
 *   • Agent registration (captures api_key, claim_url, verification_code)
 *   • Incoming webhook event ingestion with idempotency deduplication
 *     (kept for forward-compatibility; Moltbook v1 uses polling, not push)
 *
 * Configuration (via environment variables):
 *   MOLTBOOK_API_TOKEN      – Static API key (moltbook_xxx)                (required)
 *   MOLTBOOK_WEBHOOK_SECRET – Expected X-Moltbook-Secret header            (optional)
 *   FETCH_TIMEOUT_MS        – Per-request timeout in ms (default 10 000)
 *
 * Base URL: Always https://www.moltbook.com/api/v1 (hardcoded per spec).
 * WARNING: Using moltbook.com without the `www` subdomain redirects and
 *          strips the Authorization header — requests will fail silently.
 */

import fs from 'fs';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import { logEvent } from '../utils/logger';

/**
 * The canonical Moltbook API base URL.
 * Hardcoded to prevent silent auth-stripping caused by the www-redirect.
 * Validated at startup; never derived from an environment variable alone.
 */
const MOLTBOOK_BASE_URL = 'https://www.moltbook.com/api/v1';

const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '10000', 10);

// ── Token management ──────────────────────────────────────────────────────────

/**
 * In-memory static API key (moltbook_xxx).
 * Updated after a successful agent registration when the real key is returned.
 */
let currentToken: string = process.env.MOLTBOOK_API_TOKEN ?? '';

/** Replace the in-memory API key (called after successful agent registration). */
export function setMoltbookToken(token: string) {
  currentToken = token;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface MoltbookRequestOptions {
  method?: string;
  body?: unknown;
}

async function moltbookRequest(endpoint: string, opts: MoltbookRequestOptions = {}): Promise<unknown> {
  if (!currentToken) {
    logEvent('moltbook_error', { reason: 'MOLTBOOK_API_TOKEN not configured', endpoint });
    throw new Error('Moltbook adapter: MOLTBOOK_API_TOKEN is not set');
  }

  const url = `${MOLTBOOK_BASE_URL}${endpoint}`;
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

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Moltbook API error ${res.status}: ${body}`);
    logEvent('moltbook_error', { status: res.status, endpoint, body });
    throw err;
  }

  return res.json();
}

// ── Verification challenge solver ─────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

/**
 * Solve a Moltbook math-word-problem verification challenge.
 *
 * Moltbook obfuscates challenges with alternating capitalisation and
 * scattered symbols (e.g. "WhAt Is FiVe!!! pLuS## tHrEe?").
 * This solver:
 *   1. Lowercases and strips non-letter/digit/space characters
 *   2. Replaces written-out number words with digits
 *   3. Maps operation words (plus, minus, times, divided by) to operators
 *   4. Evaluates the resulting arithmetic expression
 *
 * Returns the integer result, or null if the challenge cannot be parsed.
 */
export function solveVerificationChallenge(challenge: string): number | null {
  // Strip obfuscation: lowercase, remove non-alphanumeric/space/decimal chars
  let text = challenge.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // Replace "divided by" before single-word substitutions
  text = text.replace(/\bdivided\s+by\b/g, 'dividedby');

  // Replace written-out number words with digits
  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), String(value));
  }

  // Normalize operators to symbols
  text = text
    .replace(/\bplus\b/g, '+')
    .replace(/\badd(?:ed)?\b/g, '+')
    .replace(/\bminus\b/g, '-')
    .replace(/\bsubtract(?:ed)?\b/g, '-')
    .replace(/\btimes\b/g, '*')
    .replace(/\bmultipl(?:y|ied)\b/g, '*')
    .replace(/\bdividedby\b/g, '/')
    .replace(/\bdivide(?:d)?\b/g, '/');

  // Extract a simple two-operand arithmetic expression: <num> <op> <num>
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;

  const a = parseFloat(match[1]);
  const op = match[2];
  const b = parseFloat(match[3]);

  if (isNaN(a) || isNaN(b)) return null;

  let result: number;
  switch (op) {
    case '+': result = a + b; break;
    case '-': result = a - b; break;
    case '*': result = a * b; break;
    case '/':
      if (b === 0) return null;
      result = a / b;
      break;
    default: return null;
  }

  return Number.isFinite(result) ? Math.round(result) : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface MoltbookRegistrationResult {
  agent: {
    api_key: string;
    claim_url: string;
    verification_code: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Register this agent with Moltbook.
 * Sends { name, description } and returns the full registration payload
 * including api_key, claim_url, and verification_code.
 * The caller is responsible for calling setMoltbookToken(result.agent.api_key).
 */
export async function registerAgent(meta: { name: string; description: string }): Promise<MoltbookRegistrationResult> {
  logEvent('moltbook_register_agent', { name: meta.name });
  const result = await moltbookRequest('/agents/register', { method: 'POST', body: meta });
  return result as MoltbookRegistrationResult;
}

/** GET /api/v1/home — dashboard / heartbeat; primary polling target. */
export async function getHome(): Promise<unknown> {
  logEvent('moltbook_get_home', {});
  return moltbookRequest('/home');
}

/** GET /api/v1/feed — the agent's personalised content feed. */
export async function getFeed(): Promise<unknown> {
  logEvent('moltbook_get_feed', {});
  return moltbookRequest('/feed');
}

/**
 * POST /api/v1/posts — create a post.
 * Automatically solves and submits the verification challenge if one is returned.
 */
export async function createPost(content: string): Promise<unknown> {
  logEvent('moltbook_create_post', { contentLength: content.length });
  const result = await moltbookRequest('/posts', { method: 'POST', body: { content } }) as Record<string, unknown>;
  await _handleVerification(result);
  return result;
}

/**
 * POST /api/v1/posts/{id}/comments — comment on a post.
 * Automatically solves and submits the verification challenge if one is returned.
 */
export async function createComment(postId: string, content: string): Promise<unknown> {
  logEvent('moltbook_create_comment', { postId, contentLength: content.length });
  const result = await moltbookRequest(
    `/posts/${encodeURIComponent(postId)}/comments`,
    { method: 'POST', body: { content } }
  ) as Record<string, unknown>;
  await _handleVerification(result);
  return result;
}

/** POST /api/v1/posts/{id}/upvote */
export async function upvotePost(postId: string): Promise<unknown> {
  logEvent('moltbook_upvote', { postId });
  return moltbookRequest(`/posts/${encodeURIComponent(postId)}/upvote`, { method: 'POST' });
}

/** POST /api/v1/posts/{id}/downvote */
export async function downvotePost(postId: string): Promise<unknown> {
  logEvent('moltbook_downvote', { postId });
  return moltbookRequest(`/posts/${encodeURIComponent(postId)}/downvote`, { method: 'POST' });
}

/** GET /api/v1/posts/{id}/comments — read a post's comment thread. */
export async function getPostComments(postId: string): Promise<unknown> {
  logEvent('moltbook_get_post_comments', { postId });
  return moltbookRequest(`/posts/${encodeURIComponent(postId)}/comments`);
}

/**
 * POST /api/v1/verify — submit the answer to a math verification challenge.
 * Must be called within 5 minutes of the challenge being issued or content
 * stays hidden.
 */
export async function submitVerification(verificationId: string, answer: number): Promise<unknown> {
  logEvent('moltbook_submit_verification', { verificationId, answer });
  return moltbookRequest('/verify', { method: 'POST', body: { id: verificationId, answer } });
}

/** GET /api/v1/agents/status — check claim status after registration. */
export async function getAgentStatus(): Promise<unknown> {
  logEvent('moltbook_get_agent_status', {});
  return moltbookRequest('/agents/status');
}

/** POST /api/v1/notifications/read-by-post/{id} — mark notifications read. */
export async function markNotificationsRead(postId: string): Promise<unknown> {
  logEvent('moltbook_mark_notifications_read', { postId });
  return moltbookRequest(`/notifications/read-by-post/${encodeURIComponent(postId)}`, { method: 'POST' });
}

interface VerificationChallenge {
  id: string;
  challenge: string;
}

function isVerificationChallenge(v: unknown): v is VerificationChallenge {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    typeof (v as Record<string, unknown>).challenge === 'string'
  );
}

/**
 * Internal helper: if the API response contains a verification challenge,
 * solve it automatically and submit the answer.
 * Moltbook returns { verification: { id, challenge } } on new post/comment responses.
 */
async function _handleVerification(result: Record<string, unknown>): Promise<void> {
  const v = result.verification;
  if (!isVerificationChallenge(v)) return;

  const answer = solveVerificationChallenge(v.challenge);
  if (answer === null) {
    logEvent('moltbook_verification_unsolvable', { verificationId: v.id, challenge: v.challenge });
    return;
  }
  try {
    await submitVerification(v.id, answer);
    logEvent('moltbook_verification_submitted', { verificationId: v.id, answer });
  } catch (err: any) {
    logEvent('moltbook_verification_failed', { verificationId: v.id, error: err.message });
  }
}

// ── Webhook ingestion with idempotency ────────────────────────────────────────

/**
 * Persistent dedup store for webhook event IDs.
 * In production (NODE_ENV !== 'test') the set is loaded from and saved to
 * data/moltbook_dedup.json so duplicate suppression survives process restarts.
 * In test environments the file is never read or written, keeping tests isolated.
 */
const DATA_DIR = path.join(process.cwd(), 'data');
const DEDUP_FILE = path.join(DATA_DIR, 'moltbook_dedup.json');

function loadPersistedIds(): Set<string> {
  if (process.env.NODE_ENV === 'test') return new Set();
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      const arr = JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf-8'));
      return new Set(Array.isArray(arr) ? arr : []);
    }
  } catch {
    // Ignore read errors — start with an empty set
  }
  return new Set();
}

function persistIds(ids: Set<string>): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEDUP_FILE, JSON.stringify([...ids]));
  } catch (err) {
    console.error('[moltbook] Failed to persist dedup IDs:', err);
  }
}

/** Set of already-processed event IDs — prevents double-processing. */
const processedEventIds: Set<string> = loadPersistedIds();
/** Cap the in-memory dedup set to avoid unbounded growth. */
const MAX_PROCESSED_IDS = 10_000;

/**
 * Clear the in-memory dedup store.
 * Exposed for testing purposes only — not intended for production use.
 */
export function _clearProcessedEventIds(): void {
  processedEventIds.clear();
}

/**
 * Moltbook webhook event shape (forward-compatible).
 * Moltbook v1 does not define a push-webhook payload format — agents are
 * expected to poll /home and /feed.  This interface is kept for
 * forward-compatibility if Moltbook adds push webhooks in a future spec.
 */
export interface MoltbookWebhookEvent {
  id: string;
  type: string;
  content?: string;
  [key: string]: unknown;
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
  // Optional secret validation — use timing-safe comparison to prevent
  // timing side-channel attacks against the webhook secret value (P2 fix).
  const expectedSecret = process.env.MOLTBOOK_WEBHOOK_SECRET;
  if (expectedSecret) {
    if (!secretHeader) {
      logEvent('moltbook_webhook_rejected', { reason: 'invalid_secret' });
      return null;
    }
    const headerBuf = Buffer.from(secretHeader);
    const expectedBuf = Buffer.from(expectedSecret);
    if (headerBuf.length !== expectedBuf.length || !timingSafeEqual(headerBuf, expectedBuf)) {
      logEvent('moltbook_webhook_rejected', { reason: 'invalid_secret' });
      return null;
    }
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
  persistIds(processedEventIds);

  logEvent('moltbook_webhook_received', { eventId: event.id, type: event.type });
  return event;
}
