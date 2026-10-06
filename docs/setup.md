# Setup

Requires Node ≥ 20.12, a Cloudflare account, and ideally your blog's DNS on Cloudflare. The domain names below are examples.

> In Claude Code, the [`new-setup`](../.claude/skills/new-setup/SKILL.md) skill walks you through these steps one at a time and checks each one.

```sh
npm install
cp worker/wrangler.example.jsonc worker/wrangler.jsonc   # gitignored
cp .env.example .env && chmod 600 .env                    # gitignored
```

## 1. D1 database
```sh
cd worker
npx wrangler login
npx wrangler d1 create follow      # put database_id in wrangler.jsonc and .env
npm run migrate:remote
```

## 2. Turnstile
Cloudflare dashboard → Turnstile → Add widget. Set the hostname to your blog's domain and the mode to **Managed**.
- The **site key** is public and goes into your blog's embed.
- The **secret key** goes to the Worker: `npx wrangler secret put TURNSTILE_SECRET`. Check the spelling with `npx wrangler secret list`.

## 3. Deploy the Worker
In `wrangler.jsonc`, set:
- `ALLOWED_ORIGINS`: the exact origin(s) that serve your pages
- `SITE_NAME`
- `SITE_URL`
- optionally a custom-domain `routes` entry, e.g. `follow.example.com`. It must not already have a DNS record.

Then run `npm run deploy`.

## 4. Email sending (Resend)
Sending from your own domain, with SPF, DKIM and DMARC set up, is what keeps mail out of spam. Use a subdomain such as `news.example.com`.

1. Resend → Domains → add the subdomain. Add the DNS records it shows in Cloudflare, set to **DNS only**, and wait for **Verified**.
2. DMARC: if you don't have a `_dmarc` record, turn on Cloudflare → Email → **DMARC Management**.
3. Create an API key with **Sending access** restricted to that domain, and put it in `.env` as `RESEND_API_KEY`.
4. In `.env`, set `MAIL_FROM` (e.g. `Name <you@news.example.com>`) and `MAIL_REPLY_TO`.

Test it with `npm run send -- --post-url https://example.com/ --subject Test --body note.md --test you@gmail.com`. In Gmail, ⋮ → Show original should show SPF, DKIM and DMARC all `PASS`.

## 5. CLI credentials
Cloudflare → My Profile → API Tokens → Custom token with **Account → D1 → Edit**, scoped to your account. Put it in `.env` as `CF_API_TOKEN`, along with `CF_ACCOUNT_ID`, `D1_DATABASE_ID`, `WORKER_URL` and `SITE_NAME`.

## 6. Embed the widget
See [widget.md](widget.md).

## Sending in chunks (e.g. Resend's free 100/day)
Sends are resumable, so you can simply re-run the command the next day. To control exactly who gets it when:

```sh
npm run export -- --out subscribers.csv     # one-column CSV, mode 0600
# split by hand, then:
npm run send -- --post-url … --subject … --body note.md --csv day1.csv
```

`--csv` mails only the listed addresses that are active subscribers. Unknown and unsubscribed addresses are reported and skipped, and already-sent recipients are skipped too.
