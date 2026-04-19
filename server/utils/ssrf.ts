import dns from 'dns';
import net from 'net';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

/** Hostnames / IP patterns that must never be reached by outbound HTTP requests (SSRF guard). */
const IP_OCTET = '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)';
export const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  new RegExp(`^127\\.${IP_OCTET}\\.${IP_OCTET}\\.${IP_OCTET}$`),    // 127.0.0.0/8 loopback
  /^0\.0\.0\.0$/,
  /^::1$/,                                                              // IPv6 loopback
  new RegExp(`^10\\.${IP_OCTET}\\.${IP_OCTET}\\.${IP_OCTET}$`),       // RFC-1918 10/8
  new RegExp(`^172\\.(1[6-9]|2[0-9]|3[0-1])\\.${IP_OCTET}\\.${IP_OCTET}$`),  // RFC-1918 172.16/12
  new RegExp(`^192\\.168\\.${IP_OCTET}\\.${IP_OCTET}$`),              // RFC-1918 192.168/16
  new RegExp(`^169\\.254\\.${IP_OCTET}\\.${IP_OCTET}$`),              // Link-local / cloud metadata
  /^fd[0-9a-f]{2}:/i,                                                  // IPv6 ULA fc00::/7
];

/** Returns true when the URL targets a private/loopback address or uses a disallowed scheme. */
export function isSsrfTarget(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true; // Malformed URL — block it
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true; // Only HTTP(S) outbound requests are allowed
  }
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(parsed.hostname));
}

/**
 * Async SSRF check that extends the synchronous hostname/IP check with a DNS
 * resolution step.  This defends against DNS-rebinding attacks where a public
 * hostname is temporarily made to resolve to a private IP address.
 *
 * Fails open (returns false / "not SSRF") when DNS is unavailable or times out
 * so that transient DNS issues do not block legitimate outbound calls.
 *
 * @param rawUrl  The fully-qualified URL to inspect.
 * @returns       Promise<true> if the URL should be blocked, Promise<false> if safe.
 */
export async function isSsrfTargetAsync(rawUrl: string): Promise<boolean> {
  // Fast synchronous check first (catches IP literals and non-HTTP schemes).
  if (isSsrfTarget(rawUrl)) return true;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true; // Malformed
  }

  const { hostname } = parsed;

  // If the hostname is already a raw IP address the sync check already handled it.
  if (net.isIP(hostname) !== 0) return false;

  // Resolve the hostname and check whether the resulting IP is private.
  // A 3-second timeout prevents stalls; failure is treated as safe (fail-open).
  try {
    const { address } = await Promise.race([
      dnsLookup(hostname, 4),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS lookup timeout')), 3000)
      ),
    ]);
    return PRIVATE_HOST_PATTERNS.some((p) => p.test(address));
  } catch {
    // DNS unavailable, NXDOMAIN, or timeout — fail open to avoid blocking legit calls.
    return false;
  }
}
