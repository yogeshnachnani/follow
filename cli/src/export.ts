import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ConfigError, loadEnv, openDb } from "./config.ts";
import { toEmailCsv } from "./csv.ts";

const USAGE = `Usage:
  npm run export -- --out <file.csv> [--status active|all] [--force]

Writes a one-column CSV of subscriber emails (file mode 0600). Split it and
feed the pieces to \`npm run send -- --csv <piece.csv>\` to spread a send over days.`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      status: { type: "string", default: "active" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help || !values.out) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (values.status !== "active" && values.status !== "all") {
    console.error(`--status must be "active" or "all"`);
    return 2;
  }

  loadEnv();
  const { db, label } = await openDb();
  const rows = await db.query<{ email: string }>(
    values.status === "all"
      ? "SELECT email FROM subscribers ORDER BY id"
      : "SELECT email FROM subscribers WHERE status = 'active' ORDER BY id",
  );
  // 0600: this file is personal data. "wx" refuses to clobber unless --force.
  await writeFile(values.out, toEmailCsv(rows.map((r) => r.email)), { mode: 0o600, flag: values.force ? "w" : "wx" });
  console.log(`Wrote ${rows.length} ${values.status === "all" ? "" : "active "}subscriber(s) from ${label} to ${values.out}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err?.code === "EEXIST") console.error(`${err.path} already exists (use --force to overwrite).`);
    else console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  },
);
