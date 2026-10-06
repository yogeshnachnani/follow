import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, mockTurnstile, ORIGIN, subscribeReq, subscriber } from "./helpers.ts";

beforeEach(() => {
  mockTurnstile({ success: true, hostname: "blog.example" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /subscribe", () => {
  it("stores a normalized address with a random token and CORS headers", async () => {
    const res = await call(subscribeReq({ email: " New@Example.com ", source: `${ORIGIN}/posts/x/?utm=1#c` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    const row = await subscriber("new@example.com");
    expect(row?.status).toBe("active");
    expect(row?.unsubscribe_token).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.source_url).toBe(`${ORIGIN}/posts/x/`);
  });

  it("drops a source URL from a foreign origin", async () => {
    await call(subscribeReq({ email: "src@example.com", source: "https://evil.example/x" }));
    expect((await subscriber("src@example.com"))?.source_url).toBeNull();
  });

  it("gives an identical response for an existing address and keeps its token", async () => {
    await call(subscribeReq({ email: "dup@example.com" }));
    const before = await subscriber("dup@example.com");
    const res = await call(subscribeReq({ email: "DUP@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await subscriber("dup@example.com"))?.unsubscribe_token).toBe(before?.unsubscribe_token);
  });

  it("reactivates an unsubscribed address", async () => {
    await call(subscribeReq({ email: "back@example.com" }));
    await env.DB.prepare("UPDATE subscribers SET status='unsubscribed', unsubscribed_at='x' WHERE email='back@example.com'").run();
    await call(subscribeReq({ email: "back@example.com" }));
    const row = await subscriber("back@example.com");
    expect(row?.status).toBe("active");
    expect(row?.unsubscribed_at).toBeNull();
  });

  it("rejects invalid email without calling Turnstile", async () => {
    vi.restoreAllMocks();
    const spy = mockTurnstile({ success: true });
    const res = await call(subscribeReq({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("silently accepts but does not store honeypot submissions", async () => {
    const res = await call(subscribeReq({ email: "bot@example.com", website: "http://spam" }));
    expect(res.status).toBe(200);
    expect(await subscriber("bot@example.com")).toBeNull();
  });

  it("rejects a failed Turnstile check", async () => {
    vi.restoreAllMocks();
    mockTurnstile({ success: false });
    const res = await call(subscribeReq({ email: "robot@example.com" }));
    expect(res.status).toBe(403);
    expect(await subscriber("robot@example.com")).toBeNull();
  });

  it("forwards token, secret and client IP to siteverify", async () => {
    vi.restoreAllMocks();
    const spy = mockTurnstile({ success: true });
    await call(subscribeReq({ email: "fw@example.com", turnstileToken: "abc" }, { ip: "203.0.113.9" }));
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const form = init.body as FormData;
    expect(form.get("response")).toBe("abc");
    expect(form.get("secret")).toBe(env.TURNSTILE_SECRET);
    expect(form.get("remoteip")).toBe("203.0.113.9");
  });

  it.each([null, "https://evil.example", "https://blog.example.evil.com"])("rejects origin %j", async (origin) => {
    const res = await call(subscribeReq({ email: "o@example.com" }, { origin }));
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await subscriber("o@example.com")).toBeNull();
  });

  it("answers CORS preflight only for allowed origins", async () => {
    const pre = (origin: string) =>
      call(new Request("https://follow.example/subscribe", { method: "OPTIONS", headers: { Origin: origin } }));
    const ok = await pre("http://localhost:4000");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:4000");
    expect((await pre("https://evil.example")).status).toBe(403);
  });

  it("rejects oversized and malformed bodies", async () => {
    const big = subscribeReq({ email: "big@example.com", pad: "x".repeat(5000) });
    expect((await call(big)).status).toBe(413);
    const bad = new Request("https://follow.example/subscribe", {
      method: "POST",
      headers: { Origin: ORIGIN, "CF-Connecting-IP": "10.9.9.9" },
      body: "{not json",
    });
    expect((await call(bad)).status).toBe(400);
  });

  it("rate limits repeated requests from one IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await call(subscribeReq({ email: `rl${i}@example.com` }, { ip: "198.51.100.7" }))).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
  });
});
