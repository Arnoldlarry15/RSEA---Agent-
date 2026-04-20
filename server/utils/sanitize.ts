/**
 * Prompt-injection sanitisation helpers
 * ──────────────────────────────────────
 * Centralises the injection-pattern denylist so it can be applied consistently
 * at every trust boundary:
 *   • Incoming Moltbook webhook content (server/app.ts)
 *   • LLM-generated self-modification modifiers (server/modules/controller.ts)
 *
 * Each matched pattern is replaced with the literal string `[BLOCKED]`.
 */

/** Patterns that represent known prompt-injection / goal-hijack attempts. */
export const INJECTION_PATTERNS: RegExp[] = [
  /override\s+goal\s*:/gi,
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
  /forget\s+(your\s+)?(previous\s+)?instructions?/gi,
  /new\s+(primary\s+)?goal\s*:/gi,
  /you\s+are\s+now\s+(a|an)\s+/gi,
  /\bsystem\s*:/gi,
  /ALLOW_SELF_MODIFICATION/g,
  /ALLOW_CODE_EVAL/g,
  /DRY_RUN\s*=\s*false/gi,
];

/**
 * Applies every injection-pattern denylist rule to `text`, replacing matches
 * with `[BLOCKED]`.  Returns the sanitised string.
 */
export function sanitizeContent(text: string): string {
  return INJECTION_PATTERNS.reduce((s, re) => s.replace(re, '[BLOCKED]'), text);
}
