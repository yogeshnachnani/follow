import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      // Tests run against the committed example config so it can't rot.
      wrangler: { configPath: "./wrangler.example.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          // Cloudflare's documented always-pass test secret.
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          ALLOWED_ORIGINS: "https://blog.example, http://localhost:4000",
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
