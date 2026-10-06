import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MailSender, OutgoingMail, SendResult } from "@follow/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { deliver, ensureCampaign, planSend } from "../src/campaign.ts";
import { LocalSqlite } from "../src/db.ts";
import { renderEmail } from "../src/render.ts";

const MIGRATION = readFileSync(new URL("../../worker/migrations/0001_init.sql", import.meta.url), "utf8");
const POST = "https://blog.example/posts/new/";
const rendered = renderEmail({ bodyMarkdown: "hello", postUrl: POST, siteName: "Blog" });

class FakeSender implements MailSender {
  readonly name = "fake";
  calls: { messages: OutgoingMail[]; key?: string }[] = [];
  constructor(
    readonly maxBatchSize = 2,
    private fail: (m: OutgoingMail, call: number) => boolean = () => false,
  ) {}
  async sendBatch(messages: OutgoingMail[], opts?: { idempotencyKey?: string }): Promise<SendResult[]> {
    const call = this.calls.push({ messages, key: opts?.idempotencyKey });
    return messages.map((m, i) =>
      this.fail(m, call) ? { to: m.to, ok: false, error: "boom" } : { to: m.to, ok: true, id: `id-${call}-${i}` },
    );
  }
}

let db: LocalSqlite;
beforeEach(() => {
  db = new LocalSqlite(new DatabaseSync(":memory:"));
  db.exec(MIGRATION);
  const ins = (email: string, status: string, i: number) =>
    db.query("INSERT INTO subscribers (email, status, unsubscribe_token, created_at) VALUES (?, ?, ?, 'now')", [
      email,
      status,
      `tok${i}`.padEnd(64, "0"),
    ]);
  ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"].forEach((e, i) => ins(e, "active", i));
  ins("gone@x.com", "unsubscribed", 9);
});

async function run(sender: MailSender, emails?: string[]) {
  const plan = await planSend(db, { postUrl: POST, emails });
  const campaignId = await ensureCampaign(db, POST, "New post");
  const result = await deliver({
    db, sender, campaignId, subject: "New post", rendered, workerUrl: "https://f.example/", recipients: plan.recipients, delayMs: 0,
  });
  return { plan, result };
}

describe("send campaign", () => {
  it("sends to all active subscribers in batches with unsubscribe headers", async () => {
    const sender = new FakeSender(2);
    const { plan, result } = await run(sender);
    expect(plan.recipients.map((r) => r.email)).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]);
    expect(sender.calls.map((c) => c.messages.length)).toEqual([2, 2, 1]);
    expect(result).toMatchObject({ sent: 5, failed: [], aborted: false });

    const m = sender.calls[0]!.messages[0]!;
    expect(m.headers!["List-Unsubscribe"]).toBe(`<https://f.example/unsubscribe?t=${"tok0".padEnd(64, "0")}>`);
    expect(m.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.html).toContain(POST);
  });

  it("never sends the same post twice to the same person", async () => {
    await run(new FakeSender(2));
    const again = new FakeSender(2);
    const { plan } = await run(again);
    expect(plan.recipients).toEqual([]);
    expect(plan.alreadySent).toBe(5);
    expect(again.calls).toEqual([]);
  });

  it("retries only failed recipients on re-run", async () => {
    await run(new FakeSender(2, (m) => m.to === "c@x.com"));
    const retry = new FakeSender(2);
    const { plan } = await run(retry);
    expect(plan.recipients.map((r) => r.email)).toEqual(["c@x.com"]);
  });

  it("stops after a fully failed batch and resumes later", async () => {
    const quota = new FakeSender(2, (_m, call) => call >= 2); // first batch ok, then "quota exceeded"
    const { result } = await run(quota);
    expect(quota.calls).toHaveLength(2);
    expect(result.sent).toBe(2);
    expect(result.aborted).toBe(true);
    expect(result.failed.map((f) => f.email)).toEqual(["c@x.com", "d@x.com", "e@x.com"]);

    const { plan } = await run(new FakeSender(2));
    expect(plan.recipients.map((r) => r.email)).toEqual(["c@x.com", "d@x.com", "e@x.com"]);
  });

  it("CSV mode sends only to listed active subscribers and reports the rest", async () => {
    const sender = new FakeSender(10);
    const { plan } = await run(sender, ["b@x.com", "gone@x.com", "stranger@x.com", "d@x.com"]);
    expect(plan.recipients.map((r) => r.email)).toEqual(["b@x.com", "d@x.com"]);
    expect(plan.skipped).toEqual([
      { email: "gone@x.com", reason: "unsubscribed" },
      { email: "stranger@x.com", reason: "not a subscriber" },
    ]);
    expect(sender.calls[0]!.messages.map((m) => m.to)).toEqual(["b@x.com", "d@x.com"]);
  });

  it("overlapping CSV chunks across days don't double-send", async () => {
    await run(new FakeSender(10), ["a@x.com", "b@x.com"]);
    const day2 = new FakeSender(10);
    const { plan } = await run(day2, ["b@x.com", "c@x.com"]);
    expect(plan.recipients.map((r) => r.email)).toEqual(["c@x.com"]);
    expect(plan.alreadySent).toBe(1);
  });

  it("uses a stable idempotency key per campaign batch", async () => {
    const s1 = new FakeSender(2, () => true);
    await run(s1);
    const s2 = new FakeSender(2);
    await run(s2);
    expect(s2.calls[0]!.key).toBe(s1.calls[0]!.key);
  });
});
