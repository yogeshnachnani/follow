import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { call, mockTurnstile, subscribeReq, subscriber } from "./helpers.ts";

let token = "";

beforeAll(async () => {
  mockTurnstile({ success: true, hostname: "blog.example" });
  await call(subscribeReq({ email: "leaver@example.com" }));
  vi.restoreAllMocks();
  token = (await subscriber("leaver@example.com"))!.unsubscribe_token;
});
afterEach(() => vi.restoreAllMocks());

const url = (t: string) => `https://follow.example/unsubscribe?t=${t}`;

describe("/unsubscribe", () => {
  it("GET shows a confirmation page without changing anything", async () => {
    const res = await call(new Request(url(token)));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const body = await res.text();
    expect(body).toContain('method="post"');
    expect((await subscriber("leaver@example.com"))?.status).toBe("active");
  });

  it("GET with an unknown or malformed token is a 404", async () => {
    expect((await call(new Request(url("f".repeat(64))))).status).toBe(404);
    expect((await call(new Request(url("<script>")))).status).toBe(404);
  });

  it("RFC 8058 one-click POST unsubscribes, and is idempotent", async () => {
    const post = () =>
      call(
        new Request(url(token), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
        }),
      );
    expect((await post()).status).toBe(200);
    const row = await subscriber("leaver@example.com");
    expect(row?.status).toBe("unsubscribed");
    expect(row?.unsubscribed_at).not.toBeNull();
    expect((await post()).status).toBe(200);
  });

  it("escapes SITE_NAME in pages", async () => {
    const res = await call(new Request(url(token)));
    expect(await res.text()).not.toMatch(/<script/i);
  });
});

describe("routing", () => {
  it("has no subscriber-listing endpoint", async () => {
    for (const path of ["/", "/admin", "/subscribers", "/export"]) {
      expect((await call(new Request(`https://follow.example${path}`))).status).toBe(404);
    }
  });
});
