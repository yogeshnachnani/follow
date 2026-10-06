import type { Env } from "./env.ts";
import { json } from "./http.ts";
import { handleSubscribe } from "./subscribe.ts";
import { handleUnsubscribe } from "./unsubscribe.ts";

// Static assets (follow.js) are served by the assets binding before this
// handler runs. There is intentionally no endpoint that lists subscribers.
export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === "/subscribe") return await handleSubscribe(req, env);
      if (pathname === "/unsubscribe") return await handleUnsubscribe(req, env);
      return json({ ok: false, error: "not_found" }, 404);
    } catch (err) {
      // Log the error type only; never request bodies (they contain emails).
      console.error("unhandled error", pathname, err instanceof Error ? err.name : typeof err);
      return json({ ok: false, error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
