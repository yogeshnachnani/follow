import { createHash } from "node:crypto";
import type { MailSender, OutgoingMail, SendResult } from "@follow/shared";
import { MAX_PARAMS, type Db } from "./db.ts";
import type { RenderedEmail } from "./render.ts";

export interface Recipient {
  id: number;
  email: string;
  unsubscribe_token: string;
}

export interface SendPlan {
  campaignId: number | null;
  recipients: Recipient[];
  alreadySent: number;
  /** CSV mode: addresses that can't be mailed, with the reason. */
  skipped: { email: string; reason: string }[];
}

export interface PlanInput {
  postUrl: string;
  /** CSV mode when provided; otherwise every active subscriber. */
  emails?: string[];
}

const chunk = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function findCampaign(db: Db, postUrl: string) {
  const [row] = await db.query<{ id: number; subject: string }>(
    "SELECT id, subject FROM campaigns WHERE post_url = ?",
    [postUrl],
  );
  return row ?? null;
}

export async function ensureCampaign(db: Db, postUrl: string, subject: string): Promise<number> {
  await db.query("INSERT INTO campaigns (post_url, subject, created_at) VALUES (?, ?, ?) ON CONFLICT (post_url) DO NOTHING", [
    postUrl,
    subject,
    new Date().toISOString(),
  ]);
  const row = await findCampaign(db, postUrl);
  if (!row) throw new Error("failed to create campaign");
  return row.id;
}

/** Works out who should get this post, excluding anyone already sent it. */
export async function planSend(db: Db, { postUrl, emails }: PlanInput): Promise<SendPlan> {
  let candidates: Recipient[];
  const skipped: SendPlan["skipped"] = [];

  if (emails) {
    const found = new Map<string, Recipient & { status: string }>();
    for (const part of chunk(emails, MAX_PARAMS)) {
      const rows = await db.query<Recipient & { status: string }>(
        `SELECT id, email, unsubscribe_token, status FROM subscribers WHERE email IN (${part.map(() => "?").join(",")})`,
        part,
      );
      for (const r of rows) found.set(r.email.toLowerCase(), r);
    }
    candidates = [];
    for (const email of emails) {
      const r = found.get(email);
      if (!r) skipped.push({ email, reason: "not a subscriber" });
      else if (r.status !== "active") skipped.push({ email, reason: r.status });
      else candidates.push({ id: r.id, email: r.email, unsubscribe_token: r.unsubscribe_token });
    }
  } else {
    candidates = await db.query<Recipient>(
      "SELECT id, email, unsubscribe_token FROM subscribers WHERE status = 'active' ORDER BY id",
    );
  }

  const campaign = await findCampaign(db, postUrl);
  const sent = new Set<number>();
  if (campaign) {
    const rows = await db.query<{ subscriber_id: number }>(
      "SELECT subscriber_id FROM deliveries WHERE campaign_id = ? AND status = 'sent'",
      [campaign.id],
    );
    for (const r of rows) sent.add(r.subscriber_id);
  }
  const recipients = candidates.filter((r) => !sent.has(r.id));
  return {
    campaignId: campaign?.id ?? null,
    recipients,
    alreadySent: candidates.length - recipients.length,
    skipped,
  };
}

export function unsubscribeUrl(workerUrl: string, token: string): string {
  return `${workerUrl.replace(/\/+$/, "")}/unsubscribe?t=${encodeURIComponent(token)}`;
}

export function buildMessage(
  to: string,
  subject: string,
  rendered: RenderedEmail,
  unsubUrl: string,
): OutgoingMail {
  return {
    to,
    subject,
    text: rendered.text(unsubUrl),
    html: rendered.html(unsubUrl),
    headers: {
      // RFC 2369 + RFC 8058 one-click unsubscribe; required by Gmail/Yahoo for bulk senders.
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export interface DeliverInput {
  db: Db;
  sender: MailSender;
  campaignId: number;
  subject: string;
  rendered: RenderedEmail;
  workerUrl: string;
  recipients: Recipient[];
  /** Pause between provider calls, to respect rate limits. */
  delayMs?: number;
  log?: (msg: string) => void;
}

export interface DeliverResult {
  sent: number;
  failed: { email: string; error: string }[];
  /** True when sending stopped early because a whole batch failed. */
  aborted: boolean;
}

export async function deliver(input: DeliverInput): Promise<DeliverResult> {
  const { db, sender, campaignId, subject, rendered, workerUrl, recipients, delayMs = 600, log = () => {} } = input;
  const result: DeliverResult = { sent: 0, failed: [], aborted: false };
  const batches = chunk(recipients, sender.maxBatchSize);

  for (const [i, batch] of batches.entries()) {
    if (i > 0 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const messages = batch.map((r) => buildMessage(r.email, subject, rendered, unsubscribeUrl(workerUrl, r.unsubscribe_token)));
    // Same campaign + same recipients → same key, so if we crash after the
    // provider accepted a batch but before recording it, a re-run within the
    // provider's idempotency window won't send it twice.
    const idempotencyKey = createHash("sha256")
      .update(`${campaignId}:${batch.map((r) => r.id).join(",")}`)
      .digest("hex");

    const results = await sender.sendBatch(messages, { idempotencyKey });
    const now = new Date().toISOString();
    const rows = batch.map((r, j) => {
      const res: SendResult = results[j] ?? { to: r.email, ok: false, error: "no result" };
      if (res.ok) result.sent++;
      else result.failed.push({ email: r.email, error: res.error ?? "unknown" });
      return [campaignId, r.id, res.ok ? "sent" : "failed", res.id ?? null, res.ok ? null : (res.error ?? null), now];
    });
    for (const part of chunk(rows, Math.floor(MAX_PARAMS / 6))) {
      await db.query(
        `INSERT INTO deliveries (campaign_id, subscriber_id, status, provider_id, error, sent_at)
         VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
         ON CONFLICT (campaign_id, subscriber_id) DO UPDATE SET
           status = excluded.status, provider_id = excluded.provider_id, error = excluded.error, sent_at = excluded.sent_at`,
        part.flat(),
      );
    }
    const ok = results.filter((r) => r.ok).length;
    log(`batch ${i + 1}/${batches.length}: ${ok}/${batch.length} sent`);

    if (ok === 0) {
      // Whole batch failed (bad key, daily quota, outage). Don't burn through
      // the rest of the list; the run is resumable.
      result.aborted = i < batches.length - 1;
      if (result.aborted) {
        for (const r of batches.slice(i + 1).flat()) result.failed.push({ email: r.email, error: "not attempted" });
      }
      break;
    }
  }
  return result;
}
