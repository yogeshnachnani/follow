import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResendSender, type MailSender } from "@follow/shared";
import { LocalSqlite, RemoteD1, type Db } from "./db.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Loads ENV_FILE or <repo>/.env if present. Real env vars take precedence. */
export function loadEnv(): void {
  const file = process.env.ENV_FILE ?? join(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new ConfigError(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export class ConfigError extends Error {}

/**
 * Remote D1 by default. Set D1_LOCAL=1 to use the SQLite file `wrangler dev`
 * writes (for trying things out locally), or D1_LOCAL_PATH to point at one.
 */
export async function openDb(): Promise<{ db: Db; label: string }> {
  if (process.env.D1_LOCAL_PATH || process.env.D1_LOCAL === "1") {
    const path = process.env.D1_LOCAL_PATH ?? findLocalD1();
    return { db: await LocalSqlite.open(path), label: `local SQLite (${path})` };
  }
  const db = new RemoteD1({
    accountId: required("CF_ACCOUNT_ID"),
    databaseId: required("D1_DATABASE_ID"),
    apiToken: required("CF_API_TOKEN"),
  });
  return { db, label: "remote D1" };
}

function findLocalD1(): string {
  const dir = join(REPO_ROOT, "worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite") : [];
  if (files.length !== 1) {
    throw new ConfigError(`Expected exactly one local D1 file in ${dir}; set D1_LOCAL_PATH instead.`);
  }
  return join(dir, files[0]!);
}

export function createSender(): MailSender {
  const provider = (process.env.MAIL_PROVIDER ?? "resend").toLowerCase();
  const from = required("MAIL_FROM");
  const replyTo = process.env.MAIL_REPLY_TO?.trim() || undefined;
  switch (provider) {
    case "resend":
      return new ResendSender({ apiKey: required("RESEND_API_KEY"), from, replyTo });
    default:
      throw new ConfigError(`Unknown MAIL_PROVIDER "${provider}". Supported: resend`);
  }
}
