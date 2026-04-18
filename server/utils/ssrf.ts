/** Hostnames / IP patterns that must never be reached by outbound HTTP requests (SSRF guard). */
const IP_OCTET = '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)';
const PRIVATE_HOST_PATTERNS: RegExp[] = [
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
