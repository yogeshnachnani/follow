import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { normalizeEmail } from "@follow/shared";
import { buildMessage, deliver, ensureCampaign, findCampaign, planSend, unsubscribeUrl } from "./campaign.ts";
import { ConfigError, createSender, loadEnv, openDb, required } from "./config.ts";
import { parseEmailCsv } from "./csv.ts";
import { renderEmail } from "./render.ts";

const USAGE = `Usage:
  npm run send -- --post-url <url> --subject <text> --body <note.md> [options]

Options:
  --test <email>   Send a single preview to this address only (no database writes)
  --csv <file>     Send only to the subscribers listed in this one-column CSV
  --dry-run        Show what would be sent, send nothing
  --yes            Don't ask for confirmation
  -h, --help       Show this help`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "post-url": { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      test: { type: "string" },
      csv: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const postUrl = values["post-url"];
  const subject = values.subject?.trim();
  if (!postUrl || !subject || !values.body) {
    console.error(`--post-url, --subject and --body are required.\n\n${USAGE}`);
    return 2;
  }
  if (!/^https?:\/\//.test(postUrl) || !URL.canParse(postUrl)) {
    console.error(`--post-url must be an http(s) URL: ${postUrl}`);
    return 2;
  }
  if (values.test && values.csv) {
    console.error("--test and --csv can't be combined.");
    return 2;
  }

  loadEnv();
  const workerUrl = required("WORKER_URL");
  const rendered = renderEmail({
    bodyMarkdown: await readFile(values.body, "utf8"),
    postUrl,
    siteName: required("SITE_NAME"),
  });

  if (values.test) {
    const to = normalizeEmail(values.test);
    if (!to) {
      console.error(`Invalid --test address: ${values.test}`);
      return 2;
    }
    const msg = buildMessage(to, `[TEST] ${subject}`, rendered, unsubscribeUrl(workerUrl, "preview"));
    if (values["dry-run"]) {
      console.log(msg.text);
      return 0;
    }
    const [res] = await createSender().sendBatch([msg]);
    console.log(res?.ok ? `Test email sent to ${to} (id ${res.id}).` : `Failed: ${res?.error}`);
    return res?.ok ? 0 : 1;
  }

  const { db, label } = await openDb();
  let emails: string[] | undefined;
  if (values.csv) {
    const parsed = parseEmailCsv(await readFile(values.csv, "utf8"));
    for (const bad of parsed.invalid) console.warn(`  ! ${values.csv}:${bad.line}: not an email: ${bad.value}`);
    emails = parsed.emails;
  }

  const existing = await findCampaign(db, postUrl);
  if (existing && existing.subject !== subject) {
    console.warn(`Note: this post was already announced with subject "${existing.subject}"; resuming that campaign.`);
  }
  const plan = await planSend(db, { postUrl, emails });

  console.log(`\nDatabase:   ${label}`);
  console.log(`Post:       ${postUrl}`);
  console.log(`Subject:    ${subject}`);
  console.log(`Recipients: ${values.csv ? `from ${values.csv}` : "all active subscribers"}`);
  console.log(`  to send:        ${plan.recipients.length}`);
  console.log(`  already sent:   ${plan.alreadySent}`);
  if (values.csv) console.log(`  skipped:        ${plan.skipped.length}`);
  for (const s of plan.skipped) console.log(`    - ${s.email} (${s.reason})`);
  console.log(`\n----- preview (plain-text part) -----\n${rendered.text(unsubscribeUrl(workerUrl, "<token>"))}-------------------------------------`);

  if (plan.recipients.length === 0) {
    console.log("\nNothing to send.");
    return 0;
  }
  if (values["dry-run"]) {
    console.log("\nDry run: nothing sent.");
    return 0;
  }
  const sender = createSender();
  if (!values.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nSend to ${plan.recipients.length} recipient(s) via ${sender.name}? [y/N] `);
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      return 1;
    }
  }

  const campaignId = await ensureCampaign(db, postUrl, subject);
  const result = await deliver({
    db,
    sender,
    campaignId,
    subject,
    rendered,
    workerUrl,
    recipients: plan.recipients,
    log: (m) => console.log(`  ${m}`),
  });

  console.log(`\nSent: ${result.sent}. Failed: ${result.failed.length}.`);
  for (const f of result.failed.slice(0, 20)) console.log(`  - ${f.email}: ${f.error}`);
  if (result.failed.length > 20) console.log(`  … and ${result.failed.length - 20} more`);
  if (result.aborted) console.log("Stopped early because a whole batch failed (quota or provider error).");
  if (result.failed.length) console.log("Re-run the same command later to retry; already-sent recipients are skipped.");
  return result.failed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  },
);
