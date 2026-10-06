export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface SendResult {
  to: string;
  ok: boolean;
  /** Provider's message id when ok. */
  id?: string;
  error?: string;
}

/**
 * Anything that can deliver a batch of messages. Implementations decide how to
 * chunk/throttle; callers just hand over messages and get one result per input,
 * in the same order.
 */
export interface MailSender {
  readonly name: string;
  /** Max messages accepted by a single sendBatch call. */
  readonly maxBatchSize: number;
  sendBatch(messages: OutgoingMail[], opts?: { idempotencyKey?: string }): Promise<SendResult[]>;
}

export interface SenderConfig {
  from: string;
  replyTo?: string;
}
