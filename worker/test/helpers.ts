import { env } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../src/index.ts";

export const ORIGIN = "https://blog.example";
let ipCounter = 0;

export async function call(req: Request): Promise<Response> {
  return worker.fetch(req as Request<unknown, IncomingRequestCfProperties>, env);
}

/** Each call gets a fresh IP unless one is given, so the rate limiter stays out of the way. */
export function subscribeReq(
  body: Record<string, unknown>,
  { origin = ORIGIN, ip = `10.0.0.${++ipCounter}` }: { origin?: string | null; ip?: string } = {},
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", "CF-Connecting-IP": ip };
  if (origin) headers.Origin = origin;
  return new Request("https://follow.example/subscribe", {
    method: "POST",
    headers,
    body: JSON.stringify({ turnstileToken: "tok", ...body }),
  });
}

/** Stubs Turnstile siteverify. Returns the spy so tests can inspect calls. */
export function mockTurnstile(result: { success: boolean; hostname?: string }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://challenges.cloudflare.com/")) return Response.json(result);
    throw new Error(`unexpected fetch to ${url}`);
  });
}

export async function subscriber(email: string) {
  return env.DB.prepare("SELECT * FROM subscribers WHERE email = ?1").bind(email).first<{
    email: string;
    status: string;
    unsubscribe_token: string;
    source_url: string | null;
    unsubscribed_at: string | null;
  }>();
}
