/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const jar = new Map<string, string>();
let lastSet: Record<string, unknown> | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (opts: { name: string; value: string }) => {
      jar.set(opts.name, opts.value);
      lastSet = opts;
    },
  }),
}));

import { cookieQuota } from "./cookie-quota";

const HOUR = 60 * 60 * 1000;
const quota = cookieQuota({
  cookie: "q",
  limit: 2,
  windowMs: 24 * HOUR,
  blockedMessage: (hours) => `back in ${hours}h`,
});

beforeEach(() => {
  jar.clear();
  lastSet = null;
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 2, 8, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cookieQuota", () => {
  it("allows a fresh visitor and counts only what is recorded", async () => {
    expect(await quota.check()).toMatchObject({ allowed: true, used: 0, limit: 2 });
    await quota.record();
    expect(await quota.check()).toMatchObject({ allowed: true, used: 1 });
  });

  it("blocks once the limit is used, with the hours until the window resets", async () => {
    await quota.record();
    vi.advanceTimersByTime(5 * HOUR);
    await quota.record();
    expect(await quota.check()).toMatchObject({ allowed: false, used: 2, message: "back in 19h" });
  });

  it("starts a fresh window after the old one expires", async () => {
    await quota.record();
    await quota.record();
    vi.advanceTimersByTime(25 * HOUR);
    expect(await quota.check()).toMatchObject({ allowed: true, used: 0 });
    await quota.record();
    expect(JSON.parse(jar.get("q")!)).toMatchObject({ used: 1 });
  });

  it("treats an unreadable cookie as a fresh visitor", async () => {
    jar.set("q", "not json");
    expect(await quota.check()).toMatchObject({ allowed: true, used: 0 });
    jar.set("q", JSON.stringify({ used: "2", resetAt: Date.now() + HOUR }));
    expect(await quota.check()).toMatchObject({ allowed: true, used: 0 });
  });

  it("keeps the counter in an httpOnly cookie that lives as long as the window", async () => {
    await quota.record();
    expect(lastSet).toMatchObject({ name: "q", httpOnly: true, sameSite: "lax", path: "/", maxAge: 24 * 60 * 60 });
  });
});
