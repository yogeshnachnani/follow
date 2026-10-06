import { marked } from "marked";

export interface RenderInput {
  /** Hand-written note, in Markdown. */
  bodyMarkdown: string;
  postUrl: string;
  siteName: string;
}

export interface RenderedEmail {
  text: (unsubscribeUrl: string) => string;
  html: (unsubscribeUrl: string) => string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Deliberately plain: no images, tracking pixels or heavy layout. Personal-
 * looking mail is what mailbox providers file under Primary/Updates rather
 * than Promotions. Only the footer differs per recipient.
 */
export function renderEmail({ bodyMarkdown, postUrl, siteName }: RenderInput): RenderedEmail {
  const body = bodyMarkdown.trim();
  const bodyHtml = marked.parse(body, { async: false, gfm: true, breaks: false });

  return {
    text: (unsub) =>
      `${body}\n\nRead it here: ${postUrl}\n\n--\n` +
      `You're receiving this because you subscribed to ${siteName}.\nUnsubscribe: ${unsub}\n`,
    html: (unsub) =>
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
      `<body style="margin:0;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#222">` +
      `<div style="max-width:560px;margin:0 auto">${bodyHtml}` +
      `<p><a href="${esc(postUrl)}">Read it here &rarr;</a></p>` +
      `<hr style="border:0;border-top:1px solid #ddd;margin:32px 0 16px">` +
      `<p style="font-size:13px;color:#777">You're receiving this because you subscribed to ${esc(siteName)}. ` +
      `<a href="${esc(unsub)}" style="color:#777">Unsubscribe</a></p>` +
      `</div></body></html>`,
  };
}
