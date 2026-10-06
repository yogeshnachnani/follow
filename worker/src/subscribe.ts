import { normalizeEmail } from "@follow/shared";
import { allowedOrigins, type Env } from "./env.ts";
import { corsHeaders, json } from "./http.ts";
import { verifyTurnstile } from "./turnstile.ts";

const MAX_BODY_BYTES = 4096;

interface SubscribeBody {
  email?: unknown;
  turnstileToken?: unknown;
  /** Honeypot: hidden from humans, bots tend to fill it. */
  website?: unknown;
  /** Page the form was submitted from. */
  source?: unknown;
}

export async function handleSubscribe(req: Request, env: Env): Promise<Response> {
  const origins = allowedOrigins(env);
  const origin = req.headers.get("Origin");
  if (!origin || !origins.has(origin)) {
    return json({ ok: false, error: "forbidden_origin" }, 403);
  }
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, { ...cors, Allow: "POST, OPTIONS" });

  const ip = req.headers.get("CF-Connecting-IP");
  const { success } = await env.RATE_LIMITER.limit({ key: `subscribe:${ip ?? "unknown"}` });
  if (!success) return json({ ok: false, error: "rate_limited" }, 429, cors);

  const declared = Number(req.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ ok: false, error: "too_large" }, 413, cors);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "too_large" }, 413, cors);

  let body: SubscribeBody;
  try {
    body = JSON.parse(raw);
    if (typeof body !== "object" || body === null) throw new Error();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400, cors);
  }

  // Pretend success so bots don't learn to leave the honeypot empty.
  if (typeof body.website === "string" && body.website !== "") return json({ ok: true }, 200, cors);

  const email = normalizeEmail(body.email);
  if (!email) return json({ ok: false, error: "invalid_email" }, 400, cors);

  if (!env.TURNSTILE_SECRET) {
    // Misconfiguration, not a bot: make it obvious in `wrangler tail`.
    console.error("TURNSTILE_SECRET is not set; run `wrangler secret put TURNSTILE_SECRET`");
    return json({ ok: false, error: "server_misconfigured" }, 500, cors);
  }
  const hostnames = new Set([...origins].map((o) => new URL(o).hostname));
  const human = await verifyTurnstile(String(body.turnstileToken ?? ""), env.TURNSTILE_SECRET, ip, hostnames);
  if (!human) return json({ ok: false, error: "verification_failed" }, 403, cors);

  await upsertSubscriber(env.DB, email, sourceUrl(body.source, origins));

  // Identical response whether the address was new, existing, or resubscribed,
  // so this endpoint can't be used to probe who is on the list.
  return json({ ok: true }, 200, cors);
}

function sourceUrl(source: unknown, origins: Set<string>): string | null {
  if (typeof source !== "string" || source.length > 1024) return null;
  try {
    const url = new URL(source);
    return origins.has(url.origin) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function upsertSubscriber(db: D1Database, email: string, source: string | null): Promise<void> {
  const now = new Date().toISOString();
  // New address → insert as active. Previously unsubscribed → reactivate.
  // Already active/pending → no-op.
  await db
    .prepare(
      `INSERT INTO subscribers (email, status, unsubscribe_token, source_url, created_at, confirmed_at)
       VALUES (?1, 'active', ?2, ?3, ?4, ?4)
       ON CONFLICT (email) DO UPDATE
         SET status = 'active', confirmed_at = excluded.confirmed_at, unsubscribed_at = NULL
         WHERE subscribers.status = 'unsubscribed'`,
    )
    .bind(email, newToken(), source, now)
    .run();
}
