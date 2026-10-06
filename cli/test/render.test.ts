import { describe, expect, it } from "vitest";
import { renderEmail } from "../src/render.ts";

describe("renderEmail", () => {
  const r = renderEmail({
    bodyMarkdown: "Hi!\n\nI wrote about **things**.",
    postUrl: "https://blog.example/posts/x/?a=1&b=2",
    siteName: "Blog <&>",
  });

  it("renders markdown, post link and per-recipient unsubscribe link", () => {
    const html = r.html("https://f.example/unsubscribe?t=abc");
    expect(html).toContain("<strong>things</strong>");
    expect(html).toContain('href="https://blog.example/posts/x/?a=1&#38;b=2"');
    expect(html).toContain('href="https://f.example/unsubscribe?t=abc"');
    expect(html).toContain("Blog &#60;&#38;&#62;");
    expect(html).not.toMatch(/<img/i);
  });

  it("has a plain-text part with the same links", () => {
    const text = r.text("https://f.example/unsubscribe?t=abc");
    expect(text).toContain("Read it here: https://blog.example/posts/x/?a=1&b=2");
    expect(text).toContain("Unsubscribe: https://f.example/unsubscribe?t=abc");
  });
});
