import { normalizeEmail } from "@follow/shared";

export interface ParsedCsv {
  emails: string[];
  invalid: { line: number; value: string }[];
}

/**
 * Parses a one-column CSV of email addresses. Tolerates a header row, blank
 * lines, quotes, extra columns (ignored) and duplicates (removed).
 */
export function parseEmailCsv(text: string): ParsedCsv {
  const emails = new Set<string>();
  const invalid: ParsedCsv["invalid"] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const value = (raw.split(",")[0] ?? "").trim().replace(/^"(.*)"$/, "$1").trim();
    if (!value) return;
    if (i === 0 && /^e-?mail(\s*address)?$/i.test(value)) return;
    const email = normalizeEmail(value);
    if (email) emails.add(email);
    else invalid.push({ line: i + 1, value });
  });
  return { emails: [...emails], invalid };
}

export function toEmailCsv(emails: string[]): string {
  return ["email", ...emails].join("\n") + "\n";
}
