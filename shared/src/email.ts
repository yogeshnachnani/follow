// RFC 5321 caps an address at 254 chars and the local part at 64. We don't try
// to implement full RFC 5322 grammar — that accepts things no mail provider
// does. Instead: one "@", no whitespace/control chars, a dotted domain.
const EMAIL_RE = /^[^\s@"<>()[\]\\,;:]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Returns the canonical (trimmed, lower-cased) address, or null if invalid. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  const at = email.indexOf("@");
  if (at < 1 || at > 64) return null;
  // Reject control characters explicitly (header injection, log forging).
  if (/[\u0000-\u001f\u007f]/.test(email)) return null;
  return EMAIL_RE.test(email) ? email : null;
}
