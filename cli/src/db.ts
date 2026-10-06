/** Minimal query interface over D1, implemented remotely (HTTP API) or locally (SQLite file). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

// D1 caps bound parameters per statement at 100.
export const MAX_PARAMS = 100;

interface D1ApiResponse<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: { results: T[]; success: boolean }[];
}

/**
 * Talks to D1 through Cloudflare's REST API using an API token scoped to D1.
 * https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
 */
export class RemoteD1 implements Db {
  readonly #url: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(opts: { accountId: string; databaseId: string; apiToken: string; fetch?: typeof fetch }) {
    this.#url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(opts.accountId)}/d1/database/${encodeURIComponent(opts.databaseId)}/query`;
    this.#token = opts.apiToken;
    this.#fetch = opts.fetch ?? fetch;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.#fetch(this.#url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const body = (await res.json().catch(() => null)) as D1ApiResponse<T> | null;
    if (!res.ok || !body?.success) {
      const msg = body?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
      throw new Error(`D1 query failed: ${msg}`);
    }
    return body.result?.[0]?.results ?? [];
  }
}

/**
 * Reads/writes a local SQLite file — the one `wrangler dev` uses under
 * worker/.wrangler/state — or an in-memory DB in tests. Development only.
 */
export class LocalSqlite implements Db {
  readonly #db: import("node:sqlite").DatabaseSync;

  constructor(db: import("node:sqlite").DatabaseSync) {
    this.#db = db;
  }

  static async open(path: string): Promise<LocalSqlite> {
    const { DatabaseSync } = await import("node:sqlite");
    return new LocalSqlite(new DatabaseSync(path));
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.#db.prepare(sql).all(...(params as import("node:sqlite").SQLInputValue[])) as T[];
  }
}
