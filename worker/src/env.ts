export interface Env {
  DB: D1Database;
  RATE_LIMITER: RateLimit;
  ASSETS: Fetcher;
  /** Comma-separated origins allowed to call POST /subscribe. */
  ALLOWED_ORIGINS: string;
  SITE_NAME: string;
  SITE_URL: string;
  /** Secret: Turnstile secret key. */
  TURNSTILE_SECRET: string;
}

export function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
}
