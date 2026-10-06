#!/usr/bin/env node
// End-to-end sanity harness. Starts an isolated local stack (Worker + demo
// page on free ports, throwaway D1 state), runs HTTP and CLI checks against
// it, and leaves it running so a browser pass can follow.
//
//   node scripts/verify.mjs start [--skip-unit]   start stack + run checks
//   node scripts/verify.mjs subscriber <email>     print a subscriber row (JSON)
//   node scripts/verify.mjs stop                   stop stack, delete temp state
//
// Requires network access: the Turnstile test secret is verified against
// Cloudflare's real siteverify endpoint.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// node:sqlite prints an ExperimentalWarning; it's noise in a check report.
process.removeAllListeners("warning");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER_DIR = join(ROOT, "worker");
const WRANGLER = join(ROOT, "node_modules/.bin/wrangler");
const STATE_FILE = join(ROOT, "node_modules/.cache/follow-verify/state.json");
// Cloudflare's documented always-pass Turnstile test keys.
const TEST_SECRET = "1x0000000000000000000000000000000AA";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts, env: { ...process.env, NODE_NO_WARNINGS: "1", ...opts.env } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function readState() {
  if (!existsSync(STATE_FILE)) throw new Error("No running verify stack (state file missing). Run `start` first.");
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function sqlitePath(persistDir) {
  const dir = join(persistDir, "v3/d1/miniflare-D1DatabaseObject");
  const f = readdirSync(dir).find((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
  if (!f) throw new Error(`no D1 sqlite file in ${dir}`);
  return join(dir, f);
}

async function subscriberRow(state, email) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(sqlitePath(state.persistDir), { readOnly: true });
  try {
    return db.prepare("SELECT email, status, length(unsubscribe_token) AS token_len, unsubscribe_token, source_url FROM subscribers WHERE email = ?").get(email) ?? null;
  } finally {
    db.close();
  }
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function stopState(state) {
  for (const pid of state.pids ?? []) {
    try {
      process.kill(-pid, "SIGTERM"); // whole process group (wrangler spawns workerd)
    } catch {}
  }
  rmSync(state.tmp, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
}

async function start(skipUnit) {
  if (existsSync(STATE_FILE)) {
    console.log("Stopping a previous verify stack first.");
    stopState(readState());
  }

  if (!skipUnit) {
    const t = run("npm", ["test"]);
    const counts = [...t.out.matchAll(/Tests\s+(\d+) passed/g)].map((m) => +m[1]);
    check("unit + integration tests (npm test)", t.code === 0, t.code === 0 ? `${counts.reduce((a, b) => a + b, 0)} tests passed` : t.out.slice(-2000));
    const tc = run("npm", ["run", "-s", "typecheck"]);
    check("typecheck", tc.code === 0, tc.code === 0 ? "" : tc.out.slice(-2000));
  }

  const tmp = mkdtempSync(join(tmpdir(), "follow-verify-"));
  const persistDir = join(tmp, "state");
  const [workerPort, inspectorPort, demoPort] = [await freePort(), await freePort(), await freePort()];
  const workerUrl = `http://localhost:${workerPort}`;
  const demoOrigin = `http://localhost:${demoPort}`;
  const config = join(WORKER_DIR, "wrangler.example.jsonc");

  const mig = run(WRANGLER, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistDir, "-c", config], { cwd: WORKER_DIR });
  check("apply D1 migrations to throwaway local DB", mig.code === 0, mig.code === 0 ? "" : mig.out.slice(-1500));

  // --var overrides wrangler vars and any developer .dev.vars.
  const vars = {
    TURNSTILE_SECRET: TEST_SECRET,
    ALLOWED_ORIGINS: demoOrigin,
    SITE_NAME: "Verify Blog",
    SITE_URL: demoOrigin,
  };
  const workerLog = openSync(join(tmp, "wrangler.log"), "a");
  const worker = spawn(
    WRANGLER,
    ["dev", "-c", config, "--port", String(workerPort), "--inspector-port", String(inspectorPort), "--persist-to", persistDir,
      ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
    { cwd: WORKER_DIR, detached: true, stdio: ["ignore", workerLog, workerLog] },
  );
  const demoLog = openSync(join(tmp, "demo.log"), "a");
  const demo = spawn(process.execPath, [join(ROOT, "widget/serve-demo.mjs")], {
    detached: true,
    stdio: ["ignore", demoLog, demoLog],
    env: { ...process.env, PORT: String(demoPort) },
  });
  worker.unref();
  demo.unref();

  const state = { tmp, persistDir, workerUrl, demoOrigin, pids: [worker.pid, demo.pid] };
  mkdirSync(join(STATE_FILE, ".."), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  const up = await waitFor(`${workerUrl}/follow.js`, 60_000);
  check("worker starts and serves /follow.js", up, up ? workerUrl : `see ${join(tmp, "wrangler.log")}`);
  check("demo page serves", await waitFor(`${demoOrigin}/`, 10_000), demoOrigin);
  if (up) {
    await httpChecks(state);
    cliChecks(state);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  console.log(`\nSTACK_RUNNING`);
  console.log(`  worker:   ${workerUrl}`);
  console.log(`  demo URL: ${demoOrigin}/?endpoint=${encodeURIComponent(workerUrl)}`);
  console.log(`  logs:     ${tmp}`);
  console.log(`Stop with: node scripts/verify.mjs stop`);
  return failed.length ? 1 : 0;
}

async function httpChecks(state) {
  const { workerUrl, demoOrigin } = state;
  const js = await fetch(`${workerUrl}/follow.js`);
  check("follow.js served as JavaScript", /javascript/.test(js.headers.get("content-type") ?? ""));

  const post = (body, origin = demoOrigin, ip = `10.1.0.${Math.floor(Math.random() * 250)}`) =>
    fetch(`${workerUrl}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip },
      body: JSON.stringify({ turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", ...body }),
    });

  const ok = await post({ email: "Verify-HTTP@Example.com", source: `${demoOrigin}/posts/x/` });
  const okBody = await ok.json().catch(() => ({}));
  check("subscribe from allowed origin (real Turnstile siteverify)", ok.status === 200 && okBody.ok === true, `${ok.status} ${JSON.stringify(okBody)}`);
  check("CORS header echoes allowed origin", ok.headers.get("access-control-allow-origin") === demoOrigin);
  const row = await subscriberRow(state, "verify-http@example.com");
  check("row stored normalized, active, 64-char token, source path", row?.status === "active" && row.token_len === 64 && row.source_url === `${demoOrigin}/posts/x/`, JSON.stringify(row && { ...row, unsubscribe_token: "…" }));

  const dup = await post({ email: "verify-http@example.com" });
  check("duplicate subscribe gives identical response", dup.status === 200 && (await dup.json()).ok === true);

  const evil = await post({ email: "evil@example.com" }, "https://evil.example");
  check("foreign origin rejected", evil.status === 403 && !evil.headers.get("access-control-allow-origin"));

  const bad = await post({ email: "not-an-email" });
  check("invalid email rejected", bad.status === 400);

  const hp = await post({ email: "bot@example.com", website: "http://spam" });
  check("honeypot accepted silently but not stored", hp.status === 200 && (await subscriberRow(state, "bot@example.com")) === null);

  const list = await fetch(`${workerUrl}/subscribers`);
  check("no subscriber-listing endpoint", list.status === 404);

  const unsubUrl = `${workerUrl}/unsubscribe?t=${row?.unsubscribe_token}`;
  const page = await fetch(unsubUrl);
  const pageHtml = await page.text();
  check("GET /unsubscribe shows confirm page with CSP, no state change",
    page.status === 200 && /method="post"/.test(pageHtml) && /default-src 'none'/.test(page.headers.get("content-security-policy") ?? "") &&
      (await subscriberRow(state, "verify-http@example.com"))?.status === "active");
  const oneClick = await fetch(unsubUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  check("RFC 8058 one-click POST unsubscribes", oneClick.status === 200 && (await subscriberRow(state, "verify-http@example.com"))?.status === "unsubscribed");
  const badTok = await fetch(`${workerUrl}/unsubscribe?t=${"f".repeat(64)}`);
  check("unknown unsubscribe token is 404", badTok.status === 404);

  // Leave one active subscriber for the CLI checks.
  const keep = await post({ email: "verify-cli@example.com" });
  check("second subscriber stored", keep.status === 200);
}

function cliChecks(state) {
  const envFile = join(state.tmp, "cli.env");
  writeFileSync(envFile, `WORKER_URL=${state.workerUrl}\nSITE_NAME="Verify Blog"\nD1_LOCAL_PATH=${sqlitePath(state.persistDir)}\n`);
  const note = join(state.tmp, "note.md");
  writeFileSync(note, "Hello,\n\nA new post about **verification**.\n");
  const env = { ENV_FILE: envFile, D1_LOCAL: "" };
  const base = ["run", "-s", "send", "--", "--post-url", "https://blog.example/posts/verify/", "--subject", "Verify", "--body", note];

  const dry = run("npm", [...base, "--dry-run"], { env });
  check("send --dry-run: 1 active recipient, preview has post + unsubscribe links",
    dry.code === 0 && /to send:\s+1\b/.test(dry.out) && dry.out.includes("Read it here: https://blog.example/posts/verify/") && dry.out.includes(`${state.workerUrl}/unsubscribe?t=`),
    dry.code === 0 ? "" : dry.out.slice(-1500));

  const test = run("npm", [...base, "--test", "me@example.com", "--dry-run"], { env });
  check("send --test --dry-run renders preview without DB", test.code === 0 && test.out.includes("unsubscribe?t=preview"), test.code === 0 ? "" : test.out.slice(-800));

  const out = join(state.tmp, "subs.csv");
  const exp = run("npm", ["run", "-s", "export", "--", "--out", out], { env });
  const csv = existsSync(out) ? readFileSync(out, "utf8") : "";
  check("export writes 0600 CSV of active subscribers only",
    exp.code === 0 && csv === "email\nverify-cli@example.com\n" && (statSync(out).mode & 0o777) === 0o600, exp.code === 0 ? JSON.stringify(csv) : exp.out.slice(-800));
  const again = run("npm", ["run", "-s", "export", "--", "--out", out], { env });
  check("export refuses to overwrite without --force", again.code !== 0 && /already exists/.test(again.out));

  const chunk = join(state.tmp, "chunk.csv");
  writeFileSync(chunk, "email\nverify-cli@example.com\nverify-http@example.com\nstranger@example.com\nbad\n");
  const csvRun = run("npm", [...base, "--csv", chunk, "--dry-run"], { env });
  check("send --csv: sends to listed actives, skips unsubscribed/unknown, flags bad lines",
    csvRun.code === 0 && /to send:\s+1\b/.test(csvRun.out) && /verify-http@example.com \(unsubscribed\)/.test(csvRun.out) &&
      /stranger@example.com \(not a subscriber\)/.test(csvRun.out) && /not an email: bad/.test(csvRun.out),
    csvRun.code === 0 ? "" : csvRun.out.slice(-1500));

  const missing = run("npm", ["run", "-s", "export", "--", "--out", join(state.tmp, "x.csv")], { env: { ENV_FILE: join(state.tmp, "none.env"), D1_LOCAL: "", D1_LOCAL_PATH: "", CF_ACCOUNT_ID: "" } });
  check("missing config fails with a clear message", missing.code !== 0 && /Missing required env var/.test(missing.out));
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "start") process.exitCode = await start(process.argv.includes("--skip-unit"));
  else if (cmd === "stop") {
    if (existsSync(STATE_FILE)) stopState(readState());
    console.log("Stopped.");
  } else if (cmd === "subscriber" && arg) console.log(JSON.stringify(await subscriberRow(readState(), arg.toLowerCase())));
  else {
    console.log("Usage: node scripts/verify.mjs start [--skip-unit] | subscriber <email> | stop");
    process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
