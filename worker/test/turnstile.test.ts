import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../src/turnstile.ts";
import { mockTurnstile } from "./helpers.ts";

const REAL_SECRET = "0x4AAAAAAA-real-looking-secret";
const hosts = new Set(["blog.example"]);

afterEach(() => vi.restoreAllMocks());

describe("verifyTurnstile", () => {
  it("accepts a successful token issued on our hostname", async () => {
    mockTurnstile({ success: true, hostname: "blog.example" });
    expect(await verifyTurnstile("t", REAL_SECRET, null, hosts)).toBe(true);
  });

  it("rejects a token issued on another hostname", async () => {
    mockTurnstile({ success: true, hostname: "attacker.example" });
    expect(await verifyTurnstile("t", REAL_SECRET, null, hosts)).toBe(false);
  });

  it("skips the hostname check only for Cloudflare test secrets", async () => {
    mockTurnstile({ success: true, hostname: "example.com" });
    expect(await verifyTurnstile("t", "1x0000000000000000000000000000000AA", null, hosts)).toBe(true);
  });

  it("rejects empty tokens without a network call", async () => {
    const spy = mockTurnstile({ success: true, hostname: "blog.example" });
    expect(await verifyTurnstile("", REAL_SECRET, null, hosts)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails closed when siteverify is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(await verifyTurnstile("t", REAL_SECRET, null, hosts)).toBe(false);
  });
});
