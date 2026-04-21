import { describe, it, expect, vi, afterEach } from 'vitest';
import { isSsrfTarget, isSsrfTargetAsync, PRIVATE_HOST_PATTERNS } from '../../../server/utils/ssrf';

afterEach(() => {
  vi.restoreAllMocks();
});

// ── isSsrfTarget (synchronous) ─────────────────────────────────────────────

describe('isSsrfTarget (sync)', () => {
  it('blocks localhost', () => {
    expect(isSsrfTarget('http://localhost/api')).toBe(true);
  });

  it('blocks 127.0.0.1 loopback', () => {
    expect(isSsrfTarget('http://127.0.0.1:3000/secret')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isSsrfTarget('http://0.0.0.0/x')).toBe(true);
  });

  it('blocks IPv6 loopback ::1 (bracketed URL form)', () => {
    // WHATWG URL API returns "[::1]" as the hostname; ssrf.ts strips the brackets.
    expect(isSsrfTarget('http://[::1]/x')).toBe(true);
  });

  it('blocks RFC-1918 10.x.x.x', () => {
    expect(isSsrfTarget('http://10.0.0.1/secret')).toBe(true);
  });

  it('blocks RFC-1918 172.16.x.x – 172.31.x.x', () => {
    expect(isSsrfTarget('http://172.16.0.1/')).toBe(true);
    expect(isSsrfTarget('http://172.31.255.255/')).toBe(true);
  });

  it('blocks RFC-1918 192.168.x.x', () => {
    expect(isSsrfTarget('http://192.168.1.1/')).toBe(true);
  });

  it('blocks link-local 169.254.x.x (cloud metadata)', () => {
    expect(isSsrfTarget('http://169.254.169.254/latest/meta-data/')).toBe(true);
  });

  it('blocks non-http/https schemes', () => {
    expect(isSsrfTarget('ftp://example.com/file')).toBe(true);
    expect(isSsrfTarget('file:///etc/passwd')).toBe(true);
    expect(isSsrfTarget('javascript:alert(1)')).toBe(true);
  });

  it('blocks a malformed URL', () => {
    expect(isSsrfTarget('not-a-url')).toBe(true);
    expect(isSsrfTarget('')).toBe(true);
  });

  it('allows a legitimate public HTTP URL', () => {
    expect(isSsrfTarget('http://example.com/api')).toBe(false);
  });

  it('allows a legitimate public HTTPS URL', () => {
    expect(isSsrfTarget('https://api.binance.com/api/v3/ticker/price')).toBe(false);
  });
});

// ── isSsrfTargetAsync (async — DNS-resolution paths) ──────────────────────
//
// NOTE: `vi.spyOn` cannot mock native ESM modules (e.g. `dns`) because their
// exports are not reconfigurable.  The async tests below therefore cover the
// code paths that are deterministically reachable without a DNS mock:
//
//   1. The synchronous fast-path (already-blocked URLs are caught before DNS).
//   2. The raw-IP fast-path (net.isIP detects literals, no DNS call needed).
//   3. The fail-open NXDOMAIN path (a guaranteed non-existent domain causes
//      the DNS lookup to reject, and the function returns false to avoid
//      blocking legitimate outbound calls when DNS is flaky).
// ---------------------------------------------------------------------------

describe('isSsrfTargetAsync', () => {
  it('resolves true immediately for a synchronously-blocked URL (no DNS needed)', async () => {
    await expect(isSsrfTargetAsync('http://127.0.0.1/')).resolves.toBe(true);
  });

  it('resolves true for a bracketed IPv6 loopback URL without DNS lookup', async () => {
    await expect(isSsrfTargetAsync('http://[::1]/')).resolves.toBe(true);
  });

  it('resolves false when the hostname is a raw public IP (net.isIP detects, skips DNS)', async () => {
    // 93.184.216.34 is the IP of example.com — publicly routable, no DNS needed.
    await expect(isSsrfTargetAsync('http://93.184.216.34/')).resolves.toBe(false);
  });

  it('resolves false (fail-open) when DNS lookup fails (NXDOMAIN)', async () => {
    // The `.invalid` TLD is reserved by RFC 2606 and guaranteed to never resolve.
    // The DNS lookup rejects → isSsrfTargetAsync catches the error and fails open.
    await expect(
      isSsrfTargetAsync('http://this-host-definitely-does-not-exist-rsea-test.invalid/')
    ).resolves.toBe(false);
  }, 10_000);

  it('resolves true for a private raw IP passed directly (no DNS needed)', async () => {
    await expect(isSsrfTargetAsync('http://10.0.0.1/')).resolves.toBe(true);
  });

  it('resolves true for link-local cloud metadata URL', async () => {
    await expect(isSsrfTargetAsync('http://169.254.169.254/latest/meta-data/')).resolves.toBe(true);
  });
});

// ── PRIVATE_HOST_PATTERNS coverage ────────────────────────────────────────

describe('PRIVATE_HOST_PATTERNS', () => {
  it('matches a well-known set of private hostnames / IPs', () => {
    const blocked = ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254'];
    for (const host of blocked) {
      expect(PRIVATE_HOST_PATTERNS.some(p => p.test(host))).toBe(true);
    }
  });

  it('does not match legitimate public IP addresses', () => {
    const allowed = ['93.184.216.34', '8.8.8.8', '1.1.1.1'];
    for (const ip of allowed) {
      expect(PRIVATE_HOST_PATTERNS.some(p => p.test(ip))).toBe(false);
    }
  });
});
