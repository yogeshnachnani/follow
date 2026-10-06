import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../src/email.ts";

describe("normalizeEmail", () => {
  it.each([
    ["  Foo.Bar+tag@Example.COM ", "foo.bar+tag@example.com"],
    ["a@b.co", "a@b.co"],
    ["first_last@sub.domain.io", "first_last@sub.domain.io"],
  ])("accepts %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    "",
    "plainaddress",
    "@example.com",
    "a@b",
    "a@@b.com",
    "a b@c.com",
    "a@b.c",
    "a@-b.com",
    "a\r\nbcc:x@y.com@z.com",
    "<script>@x.com",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(250)}.com`,
    42,
    null,
    { email: "a@b.com" },
  ])("rejects %j", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});
