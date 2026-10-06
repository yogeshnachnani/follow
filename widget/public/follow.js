/*!
 * follow.js — embeddable email subscribe form.
 *
 * Usage:
 *   <div data-follow
 *        data-endpoint="https://follow.example.com"
 *        data-turnstile-sitekey="0x4AAAAAAA..."
 *        data-accent="#f17bb5"></div>
 *   <script src="https://follow.example.com/follow.js" defer></script>
 *
 * Optional attributes: data-heading, data-placeholder, data-button-text,
 * data-success-text, data-accent-text, data-theme ("auto" | "light" | "dark").
 *
 * Script-only embedding: put the data-* attributes on the <script> tag itself
 * plus data-mount-after="<CSS selector>", and the box is inserted right after
 * the first matching element. Handy for themes where you can add to <head>
 * but can't easily edit the post layout.
 * Colors can also be set from page CSS via --follow-accent, --follow-accent-text,
 * --follow-text, --follow-input-bg, --follow-input-text.
 */
(function () {
  "use strict";

  var TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var DEFAULTS = {
    heading: "Thanks for reading! Subscribe for free to receive new posts.",
    placeholder: "Type your email...",
    buttonText: "Subscribe",
    successText: "Thanks! You're subscribed.",
  };
  var ERRORS = {
    invalid_email: "Please enter a valid email address.",
    rate_limited: "Too many attempts. Please try again in a minute.",
    verification_failed: "We couldn't verify you're human. Please try again.",
    default: "Something went wrong. Please try again.",
  };

  var STYLES =
    ":host{display:block;margin:2.5rem auto;max-width:30rem;text-align:center;font:inherit;" +
    "--_accent:var(--follow-accent,#f17bb5);--_accent-text:var(--follow-accent-text,#fff);" +
    "--_text:var(--follow-text,#363636);--_input-bg:var(--follow-input-bg,#efefef);--_input-text:var(--follow-input-text,#222);" +
    "--_muted:color-mix(in srgb,var(--_text) 60%,transparent)}" +
    ":host([data-resolved-theme=dark]){--_text:var(--follow-text,#d8d8d8);--_input-bg:var(--follow-input-bg,#2b2b2f);--_input-text:var(--follow-input-text,#eee)}" +
    "p{margin:0 0 1.25rem;color:var(--_text);font-size:1.2em;line-height:1.6}" +
    "form{display:flex;height:3rem;border:1px solid var(--_accent);border-radius:8px;overflow:hidden;background:var(--_input-bg)}" +
    "form:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--_accent) 30%,transparent)}" +
    "input[type=email]{flex:1;min-width:0;border:0;outline:0;padding:0 .9rem;background:transparent;color:var(--_input-text);font:inherit;font-size:1.05em}" +
    "input[type=email]::placeholder{color:var(--_muted)}" +
    "button{border:0;padding:0 1.6rem;background:var(--_accent);color:var(--_accent-text);font:inherit;font-size:1.05em;cursor:pointer;white-space:nowrap}" +
    "button:hover{filter:brightness(1.05)}button:focus-visible{outline:2px solid var(--_accent-text);outline-offset:-4px}" +
    "button[disabled]{cursor:progress;opacity:.75}" +
    ".hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}" +
    ".sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
    ".status{min-height:1.5em;margin:.6rem 0 0;font-size:.95em;color:var(--_muted)}" +
    ".status.err{color:#d33}.done{font-weight:600}" +
    "::slotted(*){display:flex;justify-content:center;margin-top:.75rem}";

  // Captured at load time; null once scripts finish executing.
  var currentScript = document.currentScript;

  var turnstileReady = null;
  function loadTurnstile() {
    if (turnstileReady) return turnstileReady;
    turnstileReady = new Promise(function (resolve, reject) {
      if (window.turnstile) return resolve(window.turnstile);
      var s = document.createElement("script");
      s.src = TURNSTILE_SRC;
      s.async = true;
      s.onload = function () {
        window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing"));
      };
      s.onerror = function () {
        turnstileReady = null;
        reject(new Error("failed to load turnstile"));
      };
      document.head.appendChild(s);
    });
    return turnstileReady;
  }

  function resolveTheme(pref) {
    if (pref === "light" || pref === "dark") return pref;
    var root = document.documentElement;
    // Chirpy uses <html data-mode="dark|light">; many themes use data-theme.
    var mode = root.getAttribute("data-mode") || root.getAttribute("data-theme");
    if (mode === "dark" || mode === "light") return mode;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text) node.textContent = text;
    return node;
  }

  function mount(host) {
    if (host.__follow) return;
    host.__follow = true;

    var d = host.dataset;
    var endpoint = (d.endpoint || "").replace(/\/+$/, "");
    if (!endpoint || !d.turnstileSitekey) {
      console.error("[follow] data-endpoint and data-turnstile-sitekey are required", host);
      return;
    }
    // Values may be colors or var(--page-variable) references.
    if (d.accent && window.CSS && CSS.supports("color", d.accent)) {
      host.style.setProperty("--follow-accent", d.accent);
    }
    if (d.accentText && window.CSS && CSS.supports("color", d.accentText)) {
      host.style.setProperty("--follow-accent-text", d.accentText);
    }

    var applyTheme = function () {
      host.setAttribute("data-resolved-theme", resolveTheme(d.theme || "auto"));
    };
    applyTheme();
    if (!d.theme || d.theme === "auto") {
      new MutationObserver(applyTheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-mode", "data-theme"],
      });
      if (window.matchMedia) {
        var mq = matchMedia("(prefers-color-scheme: dark)");
        mq.addEventListener ? mq.addEventListener("change", applyTheme) : mq.addListener(applyTheme);
      }
    }

    var uid = "follow-" + Math.random().toString(36).slice(2, 8);
    var root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", {}, STYLES));
    root.appendChild(el("p", { id: uid + "-h" }, d.heading || DEFAULTS.heading));

    var form = el("form", { novalidate: "", "aria-labelledby": uid + "-h" });
    var label = el("label", { for: uid + "-email", class: "sr" }, "Email address");
    var input = el("input", {
      id: uid + "-email",
      type: "email",
      name: "email",
      required: "",
      autocomplete: "email",
      inputmode: "email",
      maxlength: "254",
      placeholder: d.placeholder || DEFAULTS.placeholder,
    });
    // Honeypot: invisible to people and screen readers; naive bots fill it.
    var hp = el("div", { class: "hp", "aria-hidden": "true" });
    var hpInput = el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" });
    hp.appendChild(hpInput);
    var button = el("button", { type: "submit" }, d.buttonText || DEFAULTS.buttonText);
    form.append(label, input, hp, button);
    root.appendChild(form);

    var status = el("div", { class: "status", role: "status", "aria-live": "polite" });
    root.appendChild(status);

    // Turnstile renders into light DOM (its iframe doesn't belong in our shadow
    // root) and is projected below the form via a slot. With
    // appearance=interaction-only it stays invisible unless Cloudflare decides
    // a visitor needs to click a checkbox.
    root.appendChild(el("slot", { name: "turnstile" }));
    var tsBox = el("div", { slot: "turnstile" });
    host.appendChild(tsBox);

    var widgetId = null;
    var tsApi = null;
    var pending = null; // {resolve, reject} for the in-flight execute()

    function setStatus(msg, isError) {
      status.textContent = msg || "";
      status.className = "status" + (isError ? " err" : "");
    }
    function busy(on) {
      button.disabled = on;
      input.disabled = on;
    }

    function getToken(ts) {
      tsApi = ts;
      return new Promise(function (resolve, reject) {
        pending = { resolve: resolve, reject: reject };
        if (widgetId === null) {
          widgetId = ts.render(tsBox, {
            sitekey: d.turnstileSitekey,
            execution: "execute",
            appearance: "interaction-only",
            theme: resolveTheme(d.theme || "auto"),
            callback: function (token) {
              if (pending) pending.resolve(token);
              pending = null;
            },
            "error-callback": function () {
              if (pending) pending.reject(new Error("verification_failed"));
              pending = null;
            },
          });
        } else {
          ts.reset(widgetId);
        }
        ts.execute(widgetId);
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!input.checkValidity() || !email) {
        setStatus(ERRORS.invalid_email, true);
        input.focus();
        return;
      }
      busy(true);
      setStatus("");
      loadTurnstile()
        .then(getToken)
        .then(function (token) {
          return fetch(endpoint + "/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: email,
              turnstileToken: token,
              website: hpInput.value,
              source: location.href,
            }),
          });
        })
        .then(function (res) {
          return res.json().catch(function () {
            return { ok: false };
          });
        })
        .then(function (body) {
          if (!body.ok) throw new Error(body.error || "default");
          if (tsApi && widgetId !== null) tsApi.remove(widgetId);
          form.remove();
          tsBox.remove();
          setStatus("");
          status.classList.add("done");
          status.textContent = d.successText || DEFAULTS.successText;
        })
        .catch(function (err) {
          setStatus(ERRORS[err && err.message] || ERRORS.default, true);
          busy(false);
        });
    });

    // Warm up the Turnstile script so the first submit is fast.
    loadTurnstile().catch(function () {});
  }

  function mountFromScript() {
    var selector = currentScript && currentScript.getAttribute("data-mount-after");
    if (!selector || document.querySelector("[data-follow]")) return;
    var target = document.querySelector(selector);
    if (!target) {
      console.warn("[follow] data-mount-after matched nothing:", selector);
      return;
    }
    var host = document.createElement("div");
    host.setAttribute("data-follow", "");
    for (var i = 0; i < currentScript.attributes.length; i++) {
      var a = currentScript.attributes[i];
      if (a.name.indexOf("data-") === 0 && a.name !== "data-mount-after") host.setAttribute(a.name, a.value);
    }
    target.insertAdjacentElement("afterend", host);
  }

  function init() {
    mountFromScript();
    var nodes = document.querySelectorAll("[data-follow]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
