import type { MailSender, OutgoingMail, SendResult, SenderConfig } from "./mail.ts";

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";

export interface ResendConfig extends SenderConfig {
  apiKey: string;
  fetch?: typeof fetch;
}

/** https://resend.com/docs/api-reference/emails/send-batch-emails */
export class ResendSender implements MailSender {
  readonly name = "resend";
  readonly maxBatchSize = 100;
  readonly #cfg: ResendConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: ResendConfig) {
    if (!cfg.apiKey) throw new Error("ResendSender: apiKey is required");
    if (!cfg.from) throw new Error("ResendSender: from is required");
    this.#cfg = cfg;
    this.#fetch = cfg.fetch ?? fetch;
  }

  async sendBatch(messages: OutgoingMail[], opts: { idempotencyKey?: string } = {}): Promise<SendResult[]> {
    if (messages.length === 0) return [];
    if (messages.length > this.maxBatchSize) {
      throw new Error(`ResendSender: batch of ${messages.length} exceeds ${this.maxBatchSize}`);
    }
    const body = messages.map((m) => ({
      from: this.#cfg.from,
      to: [m.to],
      reply_to: this.#cfg.replyTo ? [this.#cfg.replyTo] : undefined,
      subject: m.subject,
      text: m.text,
      html: m.html,
      headers: m.headers,
    }));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#cfg.apiKey}`,
      "Content-Type": "application/json",
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const res = await this.#fetch(RESEND_BATCH_URL, { method: "POST", headers, body: JSON.stringify(body) });
    const payload = (await res.json().catch(() => null)) as
      | { data?: { id: string }[]; message?: string; name?: string }
      | null;

    if (!res.ok || !payload?.data) {
      const error = `HTTP ${res.status}: ${payload?.message ?? payload?.name ?? "unknown error"}`;
      return messages.map((m) => ({ to: m.to, ok: false, error }));
    }
    return messages.map((m, i) => {
      const id = payload.data?.[i]?.id;
      return id ? { to: m.to, ok: true, id } : { to: m.to, ok: false, error: "no id returned" };
    });
  }
}
