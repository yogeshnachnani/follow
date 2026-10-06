# Embedding the widget

Either place a `div` where the box should appear:

```html
<div data-follow
     data-endpoint="https://follow.example.com"
     data-turnstile-sitekey="0x4AAAAAAA..."></div>
<script src="https://follow.example.com/follow.js" defer></script>
```

…or use only the script tag and say where to insert the box. This is the **script-only** form, handy when you can add to `<head>` but not to the post template:

```html
<script src="https://follow.example.com/follow.js" defer
        data-mount-after="article > .content"
        data-endpoint="https://follow.example.com"
        data-turnstile-sitekey="0x4AAAAAAA..."></script>
```

| Attribute | Default |
|---|---|
| `data-endpoint` *(required)* | — |
| `data-turnstile-sitekey` *(required)* | — |
| `data-mount-after` *(script tag only)* | — (CSS selector; the box is inserted after the first match) |
| `data-accent` / `data-accent-text` | `#f17bb5` / `#fff`; also accept `var(--your-theme-variable)` |
| `data-heading` | "Thanks for reading! Subscribe for free to receive new posts." |
| `data-placeholder` / `data-button-text` / `data-success-text` | "Type your email..." / "Subscribe" / "Thanks! You're subscribed." |
| `data-theme` | `auto`: follows `<html data-mode>` (Chirpy), `<html data-theme>`, then the OS setting |

Colors can also be set from page CSS through `--follow-accent`, `--follow-accent-text`, `--follow-text`, `--follow-input-bg` and `--follow-input-text`.

## Jekyll (Chirpy theme)

1. Copy [`jekyll/follow.html`](jekyll/follow.html) to your site's `_includes/`.
2. Add `{% include follow.html %}` to `_includes/metadata-hook.html`, Chirpy's `<head>` extension point. Create the file if it doesn't exist.
3. Add a `follow:` block with `endpoint` and `turnstile_sitekey` to `_config.yml`. See the comment at the top of the include for the optional keys.
4. If PWA caching is on, add `"/turnstile/"` and `"/follow.js"` to `pwa.cache.deny_paths`. Chirpy's service worker caches cross-origin scripts, and Turnstile's must never be cached.

The box appears after the post body on post pages, in the theme's link color for light and dark mode. Hide it on a single post with `follow: false` in its front matter.

## Things to check on any site

- **Content-Security-Policy:** if your site sends one, allow `script-src https://challenges.cloudflare.com <worker origin>`, `frame-src https://challenges.cloudflare.com` and `connect-src <worker origin>`.
- **Service workers:** don't let them cache `follow.js` or `challenges.cloudflare.com/turnstile/…`.
- **Allowed origins:** the Worker's `ALLOWED_ORIGINS` must list the exact origin(s) that serve your pages. Subscribing from `localhost` fails by design.
