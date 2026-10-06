# Security model

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
| Misconfiguration hiding as "bot" | A missing `TURNSTILE_SECRET` returns `500 server_misconfigured` and logs a hint, instead of failing verification silently |

**Known gap:** Turnstile doesn't stop a real person typing in *someone else's* address. That person would get your posts until they click unsubscribe. Double opt-in would close this. The schema already has a `pending` status for it, but it isn't implemented yet.

**Token scope:** Cloudflare D1 API tokens can't be limited to a single database. The CLI's token can reach every D1 database in the account, but the CLI only opens `D1_DATABASE_ID`. You can add IP filtering or a TTL to the token if you want.

You may also want a secret scanner, e.g. [gitleaks](https://github.com/gitleaks/gitleaks) as a pre-commit hook.
