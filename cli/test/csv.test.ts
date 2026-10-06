import { describe, expect, it } from "vitest";
import { parseEmailCsv, toEmailCsv } from "../src/csv.ts";

describe("parseEmailCsv", () => {
  it("handles header, quotes, blanks, extra columns, case and duplicates", () => {
    const csv = 'email\r\n"A@x.com"\n\nb@x.com,extra\n a@X.com \nnope\n';
    expect(parseEmailCsv(csv)).toEqual({ emails: ["a@x.com", "b@x.com"], invalid: [{ line: 6, value: "nope" }] });
  });

  it("works without a header", () => {
    expect(parseEmailCsv("a@x.com\nb@x.com").emails).toEqual(["a@x.com", "b@x.com"]);
  });

  it("round-trips with toEmailCsv", () => {
    expect(parseEmailCsv(toEmailCsv(["a@x.com", "b@x.com"])).emails).toEqual(["a@x.com", "b@x.com"]);
  });
});
