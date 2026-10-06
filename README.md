# follow

A self-hosted, Substack-style "subscribe for new posts" box for static blogs (Jekyll, Hugo, anything that can include a `<script>`). Subscribers are stored in Cloudflare D1. You announce new posts by running a small CLI that emails a hand-written note plus the post link.

```
 blog page ──(follow.js + Turnstile)──▶ Cloudflare Worker ──▶ D1 (subscribers)
                                                                  ▲
 your laptop: npm run send ──(D1 HTTP API, scoped token)──────────┘
                     └──▶ Resend ──▶ subscribers' inboxes ──(one-click unsubscribe)──▶ Worker
```

- **Widget:** `widget/public/follow.js`. One script tag, no dependencies, Shadow-DOM isolated. Customizable color and text, follows light/dark mode.
- **Worker:** `worker/`. `POST /subscribe` and `GET|POST /unsubscribe`, and it serves `follow.js`. **There is no endpoint that lists subscribers.**
- **CLI:** `cli/`. `send` (all subscribers, a CSV subset, or a test address) and `export` (subscriber CSV).
- **Shared:** `shared/`. Email validation and the pluggable `MailSender` interface (Resend for now).

## Security model

| Threat | Mitigation |
|---|---|
| Bots mass-subscribing addresses | [Turnstile](https://developers.cloudflare.com/turnstile/) token verified server-side (single-use, 5-minute expiry, hostname-checked), per-IP rate limit (5/min), honeypot field |
| Other sites posting to your endpoint | Strict `Origin` allowlist (`ALLOWED_ORIGINS`); CORS headers only for those origins |
| Finding out whether someone is subscribed | `/subscribe` returns an identical response for new and existing addresses |
| Reading the subscriber list | No read endpoint exists. The CLI reads D1 through Cloudflare's API with a token you hold locally, limited to D1 |
| Unsubscribe links being guessed | 256-bit random per-subscriber tokens |
| Link scanners unsubscribing people | `GET /unsubscribe` only shows a confirmation page; only `POST` changes state (also used by RFC 8058 one-click) |
| SQL injection, header injection | Parameterized queries only; strict email validation that rejects control characters |
| Secrets leaking into the repo | Secrets live in `wrangler secret` and a gitignored `.env`; `wrangler.jsonc`, `.dev.vars` and `*.csv` are gitignored |

**What Turnstile does *not* stop:** someone with a real browser typing in *someone else's* address. That person would get your posts until they click unsubscribe. Double opt-in fixes this. The schema already has a `pending` status for it, but it isn't implemented yet.

You may want a CI secret scanner too (e.g. [gitleaks](https://github.com/gitleaks/gitleaks) as a pre-commit hook).

## Setup

Requires Node ≥ 20.12 and a Cloudflare account. The domain names below are examples.

```sh
npm install
cp worker/wrangler.example.jsonc worker/wrangler.jsonc
cp .env.example .env
```

### 1. D1 database
```sh
cd worker
npx wrangler login
npx wrangler d1 create follow           # copy database_id into wrangler.jsonc and .env
npm run migrate:remote
```

### 2. Turnstile
Cloudflare dashboard → Turnstile → Add widget. Hostname: your blog's domain. Mode: **Managed**.
- The **site key** is public and goes in your blog's config (step 5).
- The **secret key** goes to the Worker: `npx wrangler secret put TURNSTILE_SECRET`

### 3. Deploy the Worker
In `wrangler.jsonc`, set `ALLOWED_ORIGINS` (e.g. `https://yogis.blog`), `SITE_NAME` and `SITE_URL`. Optionally uncomment `routes` to use a custom domain like `follow.yogis.blog`. Then:
```sh
npm run deploy
```

### 4. Email sending (Resend)
Sending from your own domain, with SPF, DKIM and DMARC set up, is what keeps mail out of spam. Use a subdomain (e.g. `news.yogis.blog`) so newsletter reputation stays separate from your root domain.

1. Resend → Domains → add `news.yogis.blog`. Add the DNS records it shows (DKIM, plus SPF/MX for bounces) in Cloudflare DNS. Set them to **DNS only**, not proxied. Wait until Resend marks the domain verified.
2. Add DMARC on the root domain if you don't have one: TXT `_dmarc.yogis.blog` = `v=DMARC1; p=none; rua=mailto:you@example.com`. Tighten it to `p=quarantine` once reports look clean.
3. Create an API key with **Sending access**, restricted to that domain, and put it in `.env` as `RESEND_API_KEY`.
4. Set `MAIL_FROM` (e.g. `Yogi <yogi@news.yogis.blog>`) and `MAIL_REPLY_TO` (any inbox you read) in `.env`.
   Optionally use Cloudflare Email Routing so replies to the From address also reach you.

### 5. CLI credentials
Cloudflare → My Profile → API Tokens → Create Custom Token. Permission: **Account → D1 → Edit**, scoped to your account only. Put it in `.env` as `CF_API_TOKEN`, along with `CF_ACCOUNT_ID`, `D1_DATABASE_ID`, `WORKER_URL` and `SITE_NAME`.

### 6. Add the widget to your blog
Any site:
```html
<div data-follow
     data-endpoint="https://follow.yogis.blog"
     data-turnstile-sitekey="0x4AAAAAAA..."
     data-accent="#f17bb5"></div>
<script src="https://follow.yogis.blog/follow.js" defer></script>
```

| Attribute | Default |
|---|---|
| `data-endpoint` *(required)* | — |
| `data-turnstile-sitekey` *(required)* | — |
| `data-accent` | `#f17bb5` (or CSS `--follow-accent`) |
| `data-heading` | "Thanks for reading! Subscribe for free to receive new posts." |
| `data-placeholder` / `data-button-text` / `data-success-text` | "Type your email..." / "Subscribe" / "Thanks! You're subscribed." |
| `data-theme` | `auto` (follows `<html data-mode>` as used by Chirpy, `<html data-theme>`, then the OS setting) |

Colors can also be set from page CSS: `--follow-accent`, `--follow-accent-text`, `--follow-text`, `--follow-input-bg`, `--follow-input-text`.

**Jekyll / Chirpy:**
1. Copy [`docs/jekyll/follow.html`](docs/jekyll/follow.html) to your site's `_includes/`.
2. Add the `follow:` block shown in that file to `_config.yml`.
3. Copy the theme's post layout into your site: `cp "$(bundle info --path jekyll-theme-chirpy)/_layouts/post.html" _layouts/`. Then add `{% include follow.html %}` right after the post content.

If your site sends a Content-Security-Policy, allow `script-src https://challenges.cloudflare.com <worker origin>`, `frame-src https://challenges.cloudflare.com` and `connect-src <worker origin>`.

## Announcing a post

Write a short note in Markdown (e.g. `note.md`), then:

```sh
# 1. Send a preview to yourself only (no database writes)
npm run send -- --post-url https://yogis.blog/posts/foo/ --subject "New post: Foo" --body note.md --test you@gmail.com

# 2. See who would receive it
npm run send -- --post-url https://yogis.blog/posts/foo/ --subject "New post: Foo" --body note.md --dry-run

# 3. Send (asks for confirmation)
npm run send -- --post-url https://yogis.blog/posts/foo/ --subject "New post: Foo" --body note.md
```

Every email has a plain-text part and a light HTML part, the post link, a footer unsubscribe link, and `List-Unsubscribe` / `List-Unsubscribe-Post` headers. Gmail shows its own "Unsubscribe" button for these.

Sends are **resumable and never duplicate**. Each `(post, subscriber)` delivery is recorded in D1. Re-running the same command skips anyone already sent that post and retries anyone who failed. If a whole batch fails (e.g. you hit your provider's daily quota), sending stops and you can re-run the command later.

### Sending in chunks (e.g. Resend's free 100/day)

```sh
npm run export -- --out subscribers.csv          # one-column CSV, file mode 0600
# split it by hand, e.g. day1.csv, day2.csv …
npm run send -- --post-url … --subject … --body note.md --csv day1.csv
```

`--csv` mails only listed addresses that are active subscribers. Unknown or unsubscribed addresses are skipped and reported. Overlapping chunks are fine, since already-sent recipients are skipped.

## Development

```sh
cp worker/.dev.vars.example worker/.dev.vars     # Turnstile always-pass test secret
(cd worker && npm run migrate:local)
npm run dev                                      # Worker on http://localhost:8787
npm run demo                                     # demo page on http://localhost:4000
npm test && npm run typecheck
```

If those ports are taken: `npx wrangler dev --port 8799` (in `worker/`) and `PORT=4010 npm run demo`. Then open `http://localhost:4010/?endpoint=http://localhost:8799`.

The CLI can use the local database: `D1_LOCAL=1 npm run send -- … --dry-run`.

### Adding another mail provider
Implement `MailSender` (`shared/src/mail.ts`) and add a case in `cli/src/config.ts#createSender`. Then set `MAIL_PROVIDER` in `.env`.

## License
MIT
