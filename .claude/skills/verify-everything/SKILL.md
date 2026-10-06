---
name: verify-everything
description: End-to-end sanity check of this repo — unit/integration tests, typecheck, an isolated local Worker + D1, HTTP security checks, the send/export CLI, and a real-browser pass over the subscribe widget via the chrome-devtools-mcp plugin. Use after changes to the widget, Worker, or CLI, before deploying, or when asked to "verify everything".
---

# verify-everything

Runs the full local verification sequence for `follow`. Everything runs on free ports with a throwaway D1 directory, so it never touches the developer's `wrangler dev` data, `.env`, or `.dev.vars`, and it doesn't collide with servers that are already running.

Requirements: dependencies installed (`npm install`), Node ≥ 22.13 (for `node:sqlite`), and network access (the Turnstile test secret is checked against Cloudflare's real siteverify endpoint).

## Step 0 — Make sure the Chrome DevTools plugin is available

The browser phase needs the `chrome-devtools-mcp` plugin's tools (`mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`). A standalone `chrome-devtools` MCP server (`mcp__chrome-devtools__*`) works too.

1. Use ToolSearch with `"+chrome-devtools new_page"` to find out whether these tools exist.
2. If neither variant is present, **stop and ask the user** to install it:
   ```
   /plugin marketplace add ChromeDevTools/chrome-devtools-mcp
   /plugin install chrome-devtools-mcp@chrome-devtools-plugins
   ```
   then restart Claude Code so the tools load. Offer to run Steps 1 and 3 without the browser pass meanwhile, and label the result **partial**.
3. Load the tools you'll need in one ToolSearch call: `new_page`, `resize_page`, `take_screenshot`, `take_snapshot`, `fill`, `click`, `wait_for`, `evaluate_script`, `list_console_messages`, `close_page`.

## Step 1 — Start the stack and run the scripted checks

```sh
node scripts/verify.mjs start        # add --skip-unit to skip npm test + typecheck
```

This prints a `PASS`/`FAIL` line for each check. The checks cover:
- tests and typecheck
- migrations
- the Worker serving `follow.js`
- subscribe from an allowed origin, a foreign origin, an invalid email, and the honeypot
- the absence of any listing endpoint
- the unsubscribe GET/POST and RFC 8058 one-click flow
- CLI `send --dry-run`, `--test`, `--csv`, `export` (0600 file, no-clobber), and a missing-config error

At the end it prints `STACK_RUNNING` with a **demo URL**. The stack stays up for Step 2 **even if checks failed**. Record any failures; don't stop on them.

## Step 2 — Browser pass (real widget, real Turnstile test key)

Use the demo URL from Step 1. Open it with `new_page` using `isolatedContext: "verify-everything"` so the user's own tabs and cookies are untouched.

1. **Light mode, desktop:** `resize_page` to 760×600, then `take_screenshot`. Expected: a centered heading, then an email input on a light-grey background joined to a pink "Subscribe" button, inside a pink rounded border (like `intended_result.png`).
2. **Client-side validation:** `take_snapshot`, then click **Subscribe** with the field empty. Expected status text: "Please enter a valid email address."
3. **Subscribe:** `fill` the email textbox with `verify-browser@example.com`, click **Subscribe**, then `wait_for` `["You're subscribed", "went wrong", "verify"]` (15s). Expected: "Thanks! You're subscribed."
4. **Persisted:** run `node scripts/verify.mjs subscriber verify-browser@example.com`. Expected: `status: "active"`, `token_len: 64`, and `source_url` = the demo origin + `/`.
5. **Dark mode + custom accent, phone width:** reload the page (`evaluate_script` → `location.reload()`; a "context destroyed" error here is expected). Then run:
   ```js
   () => { document.documentElement.dataset.mode = "dark";
           document.getElementById("follow").style.setProperty("--follow-accent", "#3b82f6"); }
   ```
   The widget reacts through a MutationObserver, which runs asynchronously, so read the result in a **separate** `evaluate_script` call:
   `() => document.querySelector("[data-follow]").getAttribute("data-resolved-theme")`. Expected: `"dark"`. Then `resize_page` to 375×700 and `take_screenshot`. Expected: dark input, blue button and border, no horizontal overflow, heading wrapped and readable.
6. **Script-only mount:** open `<demo origin>/demo-mount.html?endpoint=<worker url, URL-encoded>`. `evaluate_script` → `() => { const h = document.querySelector("[data-follow]"); return [h?.previousElementSibling?.className, h?.nextElementSibling?.className]; }`. Expected: `["content", "post-tail-wrapper"]`. `take_screenshot`: expected a blue (`--link-color`) button with white text. Set `document.documentElement.dataset.mode = "dark"`, take another screenshot, and expect a light-blue button with dark text. Then subscribe `verify-mount@example.com` (same as step 3) and confirm it with `node scripts/verify.mjs subscriber verify-mount@example.com`.
7. **Console:** `list_console_messages` with types `["error", "warn"]`. Expected: no errors or warnings from `follow.js` or Turnstile. A 404 for `/favicon.ico` from the demo server is fine.
8. `close_page` the verify tab.

## Step 3 — Tear down (always, even after failures)

```sh
node scripts/verify.mjs stop
```

## Report

Give a compact table: each scripted check and each browser step with PASS/FAIL, the screenshots you took, and the exact failure output for anything that failed. Say plainly whether everything passed or what didn't. If the browser pass was skipped because the plugin was missing, say the run was **partial**. Don't fix anything unless the user asks. Just report it.
