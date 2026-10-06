import { describe, expect, it, vi } from "vitest";
import { ResendSender } from "../src/resend.ts";

const msg = (to: string) => ({ to, subject: "s", text: "t", html: "<p>t</p>", headers: { "X-Test": "1" } });

describe("ResendSender", () => {
  it("posts a batch and maps ids back in order", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [{ id: "id1" }, { id: "id2" }] }));
    const sender = new ResendSender({ apiKey: "re_x", from: "A <a@x.com>", replyTo: "r@x.com", fetch });
    const res = await sender.sendBatch([msg("1@x.com"), msg("2@x.com")], { idempotencyKey: "k1" });

    expect(res).toEqual([
      { to: "1@x.com", ok: true, id: "id1" },
      { to: "2@x.com", ok: true, id: "id2" },
    ]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails/batch");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("k1");
    expect(headers.Authorization).toBe("Bearer re_x");
    const body = JSON.parse(init.body as string);
    expect(body[0]).toMatchObject({ from: "A <a@x.com>", to: ["1@x.com"], reply_to: ["r@x.com"], headers: { "X-Test": "1" } });
  });

  it("marks every message failed on an API error", async () => {
    const fetch = vi.fn(async () => Response.json({ name: "rate_limit_exceeded", message: "slow down" }, { status: 429 }));
    const sender = new ResendSender({ apiKey: "re_x", from: "a@x.com", fetch });
    const res = await sender.sendBatch([msg("1@x.com")]);
    expect(res).toEqual([{ to: "1@x.com", ok: false, error: "HTTP 429: slow down" }]);
  });

  it("refuses oversized batches", async () => {
    const sender = new ResendSender({ apiKey: "re_x", from: "a@x.com", fetch: vi.fn() });
    await expect(sender.sendBatch(Array.from({ length: 101 }, (_, i) => msg(`${i}@x.com`)))).rejects.toThrow(/exceeds/);
  });
});
