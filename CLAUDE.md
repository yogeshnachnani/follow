# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

`follow` is a self-hosted email-subscribe system for static blogs, meant to be **open source and reusable as is**:

- `widget/public/follow.js`: the embeddable subscribe box. Plain ES5-style JS with no dependencies and no build step. Renders in Shadow DOM. Served by the Worker as a static asset.
- `worker/`: a Cloudflare Worker (TypeScript, no framework) with D1 storage. Routes: `POST|OPTIONS /subscribe`, `GET|POST /unsubscribe`. Schema in `worker/migrations/`.
- `cli/`: Node CLIs run with `tsx`. `send.ts` announces a post; `export.ts` writes a CSV of subscribers. They reach D1 through Cloudflare's REST API (`cli/src/db.ts`).
- `shared/`: email validation and the `MailSender` interface with its Resend implementation. Imported by the worker and the CLI as `@follow/shared` (TS source; no build).
- `scripts/verify.mjs`: the end-to-end harness. `docs/` has setup, widget and security docs. `docs/jekyll/follow.html` is the Jekyll include.
- `.claude/skills/`: `new-setup` (guided first-time setup) and `verify-everything` (full sanity check, including a browser pass).

## Commands

```sh
npm install                 # .npmrc sets legacy-peer-deps (works around an npm 11 crash: "reading 'edgesOut'")
npm test                    # vitest in shared/, worker/ (inside workerd, real local D1), cli/ (node:sqlite)
npm run typecheck
npm run verify:start        # isolated stack (free ports, throwaway D1) + ~24 HTTP/CLI checks; leaves it running
npm run verify:stop
npm run dev                 # wrangler dev (needs worker/wrangler.jsonc + worker/.dev.vars)
npm run demo                # widget/demo.html on :4000 (PORT=… to change; add ?endpoint=… for a non-default worker)
npm run deploy              # wrangler deploy — this is also how widget changes ship (follow.js is a Worker asset)
D1_LOCAL=1 npm run send -- … --dry-run   # the CLI against the local wrangler dev database
```

Prefer `npm run verify:start` over hand-starting servers: the developer's ports (e.g. 4000, 8787) may be taken by unrelated processes, and the harness never touches their dev data. **Don't kill processes you didn't start.**

## Invariants (don't break these)

- **No endpoint may list or reveal subscribers.** The only read path is the CLI with the user's D1 token.
- `/subscribe` returns the **same** `{ok:true}` for new, existing and reactivated addresses, so it can't be used to check whether someone subscribed. A honeypot hit also returns `{ok:true}`.
- `GET /unsubscribe` **never changes state.** Mail scanners prefetch links. Only `POST` unsubscribes, which also covers RFC 8058 one-click (`List-Unsubscribe-Post`). Unsubscribe is deliberately not rate limited, because one-click POSTs come from a few mailbox-provider IPs.
- **Order checks from cheap to expensive** in `/subscribe`: origin → rate limit → size → JSON → honeypot → email → Turnstile → DB. A missing `TURNSTILE_SECRET` is `500 server_misconfigured`, never a silent bot rejection.
- **SQL:** parameterized only. D1 allows **≤100 bound params per statement**, so batch with `MAX_PARAMS` (`cli/src/db.ts`).
- **Sends are idempotent and resumable** through `campaigns` (unique `post_url`) and `deliveries` (PK `campaign_id, subscriber_id`). Already-`sent` rows are skipped, and `failed` rows are retried. Each batch has an idempotency key derived from campaign + recipient IDs. A fully failed batch aborts the run (quota/outage). Keep all of this when changing `cli/src/campaign.ts`.
- **Every outgoing email** has text and HTML parts, the post link, a footer unsubscribe link, and `List-Unsubscribe` + `List-Unsubscribe-Post` headers. Keep the template plain (no images or tracking): plain mail is what lands in Primary/Updates instead of Promotions.
- **Never log email addresses** or request bodies in the Worker.
- **Widget:**
  - No dependencies and no build. Must work as a classic `defer` script.
  - The Turnstile container lives in **light DOM** (slotted), not in the shadow root.
  - Turnstile runs with `execution: "execute"` + `appearance: "interaction-only"`, and `turnstile.remove()` is called before the container is torn down.
  - `document.currentScript` is captured at load time, for `data-mount-after`.

## Config, secrets, open source

- **Nothing site-specific goes in tracked files.** Per-site config lives only in gitignored `worker/wrangler.jsonc`, `worker/.dev.vars` and `.env`, which are copied from the `*.example` files. If you add a config value, add it to the matching example file with a placeholder and a comment.
- **Worker secrets** (`TURNSTILE_SECRET`) go through `wrangler secret put`. **CLI secrets** (`CF_API_TOKEN`, `RESEND_API_KEY`) go in `.env`. Never ask users to paste secrets into chat; they run `! …` commands or edit `.env` themselves. Never print them; check with `grep -q`.
- `*.csv` is gitignored (subscriber exports are personal data, written with mode `0600`).

## Testing notes

- Worker tests run against `wrangler.example.jsonc`, so the example config can't rot. They use Cloudflare's always-pass Turnstile test secret and stub `fetch` for siteverify (`worker/test/helpers.ts`). Give each request a distinct `CF-Connecting-IP`, or the rate limiter will interfere.
- **`compatibility_date` must not be newer than the workerd bundled with `@cloudflare/vitest-pool-workers`.** Otherwise tests fail with "requires compatibility date …". Check before bumping it.
- **`vitest` stays on 4.x**, because of the pool-workers peer dependency.
- The CLI tests apply the real migration to an in-memory `node:sqlite` database and use a fake `MailSender`.
- `scripts/verify.mjs` needs network access: the test secret is checked by Cloudflare's real siteverify.
- **After widget or Worker changes,** run `npm test`, then the `verify-everything` skill (or at least `npm run verify:start` and its browser steps).

## Extending

- **New mail provider:** implement `MailSender` (`shared/src/mail.ts`), add a case in `cli/src/config.ts#createSender`, and document `MAIL_PROVIDER` in `.env.example`.
- **Double opt-in** isn't implemented yet. The schema's `pending` status is reserved for it. It would need the Worker to send confirmation mail, so it would also need a mail API key as a Worker secret. Don't add a half-working flag.
- **Schema changes:** add a new numbered file in `worker/migrations/`. Never edit applied migrations. Remote: `npm run migrate:remote -w worker`.
