import type { Env } from "./env.ts";
import { escapeHtml, html } from "./http.ts";

const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * GET  /unsubscribe?t=TOKEN → confirmation page (no state change; mail
 *      scanners pre-fetch links and must not unsubscribe people).
 * POST /unsubscribe?t=TOKEN → unsubscribes. Used by the page's button and by
 *      mail clients' RFC 8058 one-click unsubscribe.
 *
 * Deliberately not rate limited: one-click POSTs arrive from a few mailbox
 * provider IPs, and tokens are 256-bit random so guessing is infeasible.
 */
export async function handleUnsubscribe(req: Request, env: Env): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }

  const row = TOKEN_RE.test(token)
    ? await env.DB.prepare("SELECT status FROM subscribers WHERE unsubscribe_token = ?1")
        .bind(token)
        .first<{ status: string }>()
    : null;
  if (!row) {
    return page(env, "Link not valid", "<p>This unsubscribe link is invalid or has expired.</p>", 404);
  }

  if (req.method === "GET") {
    if (row.status === "unsubscribed") return done(env);
    const action = `/unsubscribe?t=${token}`;
    return page(
      env,
      "Unsubscribe",
      `<p>Stop receiving new-post emails from ${escapeHtml(env.SITE_NAME)}?</p>
       <form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>`,
    );
  }

  await env.DB.prepare(
    `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ?1
     WHERE unsubscribe_token = ?2 AND status != 'unsubscribed'`,
  )
    .bind(new Date().toISOString(), token)
    .run();
  return done(env);
}

function done(env: Env): Response {
  return page(env, "Unsubscribed", "<p>You've been unsubscribed and won't receive any more emails.</p>");
}

function page(env: Env, title: string, body: string, status = 200): Response {
  const site = escapeHtml(env.SITE_NAME);
  return html(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · ${site}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 32rem; margin: 15vh auto; padding: 0 16px; line-height: 1.6; text-align: center; }
  button { font: inherit; padding: .6em 1.4em; border-radius: 8px; border: 1px solid currentColor; background: none; color: inherit; cursor: pointer; }
  a { color: inherit; }
</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}<p><a href="${escapeHtml(env.SITE_URL)}">← Back to ${site}</a></p></body></html>`,
    status,
  );
}
