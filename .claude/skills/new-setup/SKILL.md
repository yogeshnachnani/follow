---
name: new-setup
description: Guided first-time setup of `follow` for a new blog. Covers Cloudflare D1, Turnstile, Worker deploy on a custom domain, email sending (Resend + SPF/DKIM/DMARC), a D1-scoped API token for the CLI, embedding the widget in the blog, and a live end-to-end test. Use when someone wants to set this project up for their own site, or asks to "set up follow", "deploy this for my blog", or "new setup".
---

# new-setup

This walks a new adopter through the one-time setup, **one step at a time**. It's distilled from a real setup. The "Gotcha" notes are things that actually went wrong.

## Ground rules

- **One step at a time.** Do everything you can yourself (CLI, config files, verification). When a step needs the user's accounts, browser or dashboards, give them short numbered instructions, **stop, and wait** for their confirmation. Then verify the result yourself before moving on.
- **Never ask for secrets in chat.** Secrets are the Turnstile secret, the Resend API key and the Cloudflare API token. The user puts them in place themselves: `! npx wrangler secret put …` for Worker secrets, or by editing `.env`. Public values, like the Turnstile **site key**, are fine to paste.
- **The user runs interactive commands with `!`** (e.g. `! cd worker && npx wrangler login`). Non-interactive wrangler can't log in.
- **Only gitignored files hold per-site config:** `worker/wrangler.jsonc`, `worker/.dev.vars` and `.env`. Never commit site-specific values into tracked files. This repo is meant to be reused as is.
- **Verify, then report.** After each step, show what you checked and the result. If something fails, fix it or explain it before continuing.
- Keep a short running log of values and decisions (domains, IDs, which branch the blog changes went on), so the closing summary is accurate.

## Step 0: Prerequisites and inputs

Check:
- `node -v` is ≥ 20.12 for the CLI, or ≥ 22.13 for `scripts/verify.mjs` and local mode. Run `npm install` from the repo root. `.npmrc` sets `legacy-peer-deps` to work around an npm 11 crash ("Cannot read properties of null (reading 'edgesOut')").
- `dig +short NS <blog domain>`: the setup below assumes the blog's DNS is **on Cloudflare**. That's needed for the Worker's custom domain and makes the email DNS records easy. If it isn't, tell the user. Their options are to move DNS to Cloudflare, or to use the `*.workers.dev` URL and add the email records at their own DNS host. Adjust steps 3 and 4 accordingly.
- `curl -sI https://<blog>` and `curl -sI https://www.<blog>`: find which origin actually serves pages. A `www` that 301-redirects to the apex doesn't need to be allowed. Also check for a `Content-Security-Policy` header; if there is one, step 6 must extend it.

Ask the user, in one message:
1. The blog URL, plus where its source code is, and what it's built with (static generator and theme, or hosted platform). Step 6 depends on this.
2. The site name for the email footer and the unsubscribe page.
3. The Worker hostname (default `follow.<blog domain>`).
4. The sending subdomain and From address (default `news.<blog domain>`, e.g. `Name <name@news.example.com>`). Recommend a subdomain: it keeps newsletter reputation separate from the root domain.
5. The Reply-To address: any inbox they read. It doesn't have to be on the blog's domain.

## Step 1: Cloudflare login and the D1 database

1. `cd worker && npx wrangler whoami`. If it isn't logged in, or the token expired, **user:** `! cd worker && npx wrangler login`. If there are several accounts, ask which one to use and set `account_id` in `wrangler.jsonc`.
2. `npx wrangler d1 list`: check there's no name clash with `follow`.
3. `npx wrangler d1 create follow`. Its "add it on your behalf?" prompt falls back to **no** when non-interactive, so add the ID yourself:
   - `cp wrangler.example.jsonc wrangler.jsonc` and set `database_id`.
   - In the repo root, `cp .env.example .env && chmod 600 .env`. Fill in `CF_ACCOUNT_ID` (from `whoami`) and `D1_DATABASE_ID`.
4. `npx wrangler d1 migrations apply DB --remote`. Its confirm prompt falls back to yes.
5. **Verify:** `npx wrangler d1 execute DB --remote --json --command "SELECT name FROM sqlite_master WHERE type='table'"` should list `subscribers`, `campaigns` and `deliveries`.

## Step 2: Turnstile (bot protection)

**User:** go to Cloudflare dashboard → Turnstile → Add widget, and set:
- Name: anything
- Hostnames: the blog origin(s) from Step 0
- Mode: **Managed**
- Pre-clearance: **No**

Then:
- paste the **site key** (public) in chat
- set the **secret** themselves with `! cd worker && npx wrangler secret put TURNSTILE_SECRET`. If wrangler offers to create the Worker, answer **yes**.

**Verify:** `npx wrangler secret list` must show exactly `TURNSTILE_SECRET`.
**Gotcha:** a user typed `TURNSITE_SECRET`. The Worker then answered every subscribe with `verification_failed`; it now returns `500 server_misconfigured` instead. Ask the user to re-put it with the correct name, and delete the misspelled one with `npx wrangler secret delete <name>`.

## Step 3: Configure and deploy the Worker

1. `dig +short <worker host>` must be **empty**. A custom domain can't take over an existing record.
2. In `worker/wrangler.jsonc`, set:
   - `routes`: `[{ "pattern": "<worker host>", "custom_domain": true }]`
   - `ALLOWED_ORIGINS`: the exact origin(s) that serve pages, comma-separated, no trailing slash
   - `SITE_NAME`
   - `SITE_URL`

   In `.env`, set `WORKER_URL=https://<worker host>` and `SITE_NAME`.
3. `npx wrangler deploy --dry-run` should list the bindings with no errors. Then run `npx wrangler deploy`. The certificate for a new custom domain usually takes under a minute.
4. **Verify against production** with curl, retrying until the certificate is live:
   - `GET /follow.js` → 200, `text/javascript`
   - `OPTIONS /subscribe` with an allowed `Origin` → 204
   - `POST /subscribe` with a foreign `Origin` → 403 `forbidden_origin`
   - an allowed origin with an invalid email → 400 `invalid_email`
   - an allowed origin with a forged token → **403 `verification_failed`**. This proves the secret is set; `500 server_misconfigured` means it isn't.
   - `GET /subscribers` → 404
   - `GET /unsubscribe?t=<64 f's>` → 404

5. **Edge allowlist (user):** Cloudflare accepts connections for the hostname on every supported HTTP port (8443, 2053, 8080, …), and scanners probe them. The connection itself can't be refused on shared IPs. Have the user add a WAF custom rule: dashboard → domain → Security → WAF → Custom rules → **Block**, with
   `(http.host eq "<worker host>" and (cf.edge.server_port ne 443 or not http.request.uri.path in {"/follow.js" "/subscribe" "/unsubscribe"}))`.
   **Verify:**
   - `:8443/favicon.ico` → 403
   - `/favicon.ico` → 403
   - `/follow.js` → 200
   - `OPTIONS /subscribe` → 204
   - `/unsubscribe?t=<64 f's>` → 404 from the Worker, not 403

   Warn against Bot Fight Mode on this zone: it would challenge Gmail/Yahoo one-click unsubscribe POSTs. `wrangler.jsonc` already sets `workers_dev: false` + `preview_urls: false`, so the WAF can't be bypassed.

A real subscribe can't be tested yet, because Turnstile only issues tokens on the blog's hostname. That happens in Step 7.

## Step 4: Email sending (Resend + DNS)

**User:**
1. At resend.com → Domains → Add domain, add the sending subdomain.
2. Add the DNS records Resend shows (DKIM, plus SPF/MX for bounces) in Cloudflare DNS, set to **DNS only** (grey cloud), or use Resend's Cloudflare auto-configure if it's offered. Wait for **Verified**.
3. **DMARC:** if `dig +short TXT _dmarc.<blog domain>` is empty, turn on Cloudflare → the domain → Email → **DMARC Management**. It publishes `p=none` and collects reports. If a DMARC record already exists, leave it alone.
4. Resend → API Keys → create a key with **Sending access**, restricted to that domain, and put it **directly into `.env`** as `RESEND_API_KEY`.

**You:** set `MAIL_FROM` and `MAIL_REPLY_TO` in `.env`. **Verify** with `grep -q '^RESEND_API_KEY=re_' .env` (don't print it) and dig the DKIM, SPF and DMARC records. The exact record names vary; Resend has changed infrastructure before.

**Test send:** write a short note to a scratch file, then run `npm run send -- --post-url https://<blog>/ --subject "Test" --body <note> --test <user's inbox>`. Ask the user to report:
- which tab it landed in
- the SPF, DKIM and DMARC results from Gmail's ⋮ → Show original (all should be PASS)
- whether replies go to Reply-To

The footer unsubscribe link in a `--test` email intentionally shows "Link not valid".

(Reference result: Updates tab, all three PASS, with this repo's plain template + own subdomain + DMARC.)

## Step 5: Cloudflare API token for the CLI

**User:** Cloudflare → My Profile → API Tokens → Create Token → **Custom token**:
- Name: `follow-cli`
- Permissions: **Account → D1 → Edit**. Edit is needed because the CLI records deliveries.
- Account Resources: only their account
- IP filtering and TTL: optional

They put it **directly into `.env`** as `CF_API_TOKEN`.

**Verify:**
- `npm run send -- --post-url https://<blog>/ --subject x --body <note> --dry-run` reports `remote D1` and 0 recipients.
- `npm run export -- --out <scratch>/x.csv` writes a `0600` file. Delete it afterwards.
- Read-only probes with the token: `GET /user/tokens/verify` is active, and `GET /accounts/<id>/workers/scripts/<worker>/secrets`, `/storage/kv/namespaces` and `/r2/buckets` are all denied.

**Gotcha:** `GET /accounts/<id>/workers/scripts` returns `success` with **0 items** even without permission. That's a false positive; judge scope by the secrets endpoint instead.

Tell the user that D1 tokens can't be limited to a single database, so the token can reach every D1 database in the account. The CLI only ever opens `D1_DATABASE_ID`.

## Step 6: Embed the widget in the blog (platform-specific; confirm first)

**This step depends entirely on the user's blog.** Before doing anything:
- **confirm** the platform and theme with the user, or work them out from the codebase if it's available locally (e.g. `_config.yml` + `Gemfile` → Jekyll; check `theme:`)
- read the blog repo's own `CLAUDE.md`/README for its conventions and its deploy process

The reference recipe below is for **Jekyll with the Chirpy theme (gem-based, v7)**. For anything else, adapt the principles in "Any platform" and agree the approach with the user before editing their repo.

### Any platform: principles and checks

- **Embed:** the widget is one script tag. Use either a `<div data-follow …>` placed in the post template, or the attributes on the `<script>` itself plus `data-mount-after="<CSS selector of the post body>"`. The second option is useful when only `<head>` is easy to extend.
  - Required: `data-endpoint`, `data-turnstile-sitekey`.
  - Optional: `data-accent`, `data-accent-text` (both accept `var(--theme-variable)`), `data-heading`, `data-button-text`, `data-theme`.
- **Show it on posts only,** with a per-post opt-out if the platform has front matter.
- **Dark mode:** the widget follows `<html data-mode>`, `<html data-theme>` or the OS setting. Check the theme's mechanism and test both modes.
- **CSP:** if the site sends one, allow `script-src https://challenges.cloudflare.com <worker origin>`, `frame-src https://challenges.cloudflare.com` and `connect-src <worker origin>`.
- **Service workers/PWA:** if the site has one, check whether it caches cross-origin GETs. Turnstile's `api.js` must **never** be cached, and `follow.js` should not be pinned to a stale copy.
- **Verify** with a production build served locally: placement, both color modes, no console errors. Subscribing from `localhost` fails by design (allowed origins, Turnstile hostname).
- **Deploying the blog is the user's call.** Commit locally and follow their documented deploy process. Leave pushing and publishing to them.
- **Offer to document it** in the blog repo's `CLAUDE.md`/README: where the widget comes from, how it's wired, and how to hide it on a post.

### Reference: Jekyll + Chirpy 7

1. `cp <follow>/docs/jekyll/follow.html <blog>/_includes/follow.html`. It emits the script tag only when `page.layout == 'post'` and `page.follow != false`, mounts after `article > .content`, and defaults the colors to `var(--link-color)` / `var(--main-bg)`, so it follows Chirpy's light/dark mode.
2. Add `{% include follow.html %}` to `_includes/metadata-hook.html`, Chirpy's `<head>` extension point. Create it if it's missing. **Gotcha:** check other branches with `git log --all -- _includes/metadata-hook.html`. If another branch also creates this file, warn the user about the future merge conflict ("keep every line").
3. Add to `_config.yml`:
   ```yaml
   follow:
     endpoint: https://<worker host>
     turnstile_sitekey: <site key>
     heading: "Thanks for reading! Subscribe for free to receive new posts."
   ```
4. **Gotcha (PWA):** Chirpy's service worker caches **every** GET, including cross-origin ones, and only clears that cache on a theme upgrade. Under `pwa.cache.deny_paths` add `"/turnstile/"` and `"/follow.js"`. These entries match the URL **path on any host**. Verify by checking the built `assets/js/data/swconf.js`.
5. **Verify:**
   - Run `JEKYLL_ENV=production bundle exec jekyll build -d <scratch>` and serve it with `python3 -m http.server`.
   - In a browser, check the box sits between `.content` and `.post-tail-wrapper`, in both modes (use Chirpy's mode toggle), with no console errors.
   - **Reload once** so the service worker controls the page, then confirm Cache Storage holds no `follow.js` or Turnstile URLs, while other third-party assets are cached.
   - Check that a scratch post with `follow: false` renders no script tag. Build from a scratch copy; never add test posts to their `_posts/`.
   - Check that only post pages carry the tag.
6. Commit in the blog repo. Then run their deploy process, and let the user push.

## Step 7: Live end-to-end test

1. **User:** subscribe on a live post with an inbox they can check, and tell you which address.
2. **Verify** in production: `SELECT email, status, length(unsubscribe_token), source_url FROM subscribers`. Expect `active`, 64, and the post URL.
3. **Real send to only that address:** put the address in a one-line CSV in scratch, then run `npm run send -- --post-url <a real post> --subject "New post: …" --body <note> --csv <that file> --dry-run`, then the same with `--yes`. Then **re-run** it and expect "already sent: 1 — Nothing to send". (Announcing a real post here is fine. Later, when the post goes out to everyone, the CLI skips this person.)
4. **User:** open the email and click the footer **Unsubscribe** link, then **Confirm**. Or use Gmail's one-click button. Verify `status = 'unsubscribed'` with a timestamp. Mention that subscribing again reactivates the same row.

## Wrap-up

Give the user a summary with:
- the live URLs
- which gitignored files hold their config (`worker/wrangler.jsonc`, `.env`)
- where the secrets live (Worker secret, `.env`)
- how to announce a post (`npm run send -- --post-url … --subject … --body note.md`, starting with `--test` and `--dry-run`)
- how to send in chunks under a provider's daily cap (`npm run export` + `--csv`, or simply re-run later, since sends resume)
- that the `verify-everything` skill checks the repo after changes

Also remind them that `wrangler.jsonc` and `.env` aren't in git. They should back them up somewhere safe, but never commit them.
