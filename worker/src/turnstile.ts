const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's documented test secrets (always pass / always fail / already
// spent). Their dummy tokens report hostname "example.com", so we can't apply
// the hostname check when one is in use. Never deploy with a test secret.
const TEST_SECRET_RE = /^[123]x0+AA$/;

interface SiteverifyResponse {
  success: boolean;
  hostname?: string;
  "error-codes"?: string[];
}

/**
 * Verifies a Turnstile token server-side. Tokens are single-use and expire
 * after 300s; siteverify enforces both. We additionally require the token to
 * have been issued on one of our own hostnames.
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string | null,
  allowedHostnames: Set<string>,
): Promise<boolean> {
  if (!token || token.length > 2048 || !secret) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  let result: SiteverifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    if (!res.ok) return false;
    result = await res.json();
  } catch {
    return false;
  }
  if (!result.success) return false;
  if (TEST_SECRET_RE.test(secret)) return true;
  return result.hostname !== undefined && allowedHostnames.has(result.hostname);
}
