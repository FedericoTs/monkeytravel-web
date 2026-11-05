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

  it("counts a use with an id once, and lets it through at the limit under that id alone", async () => {
    await quota.record("a");
    await quota.record("b");
    await quota.record("b");
    expect(JSON.parse(jar.get("q")!)).toMatchObject({ used: 2, lastUse: "b" });
    expect(await quota.check("b")).toMatchObject({ allowed: true, used: 2 });
    expect(await quota.check("a")).toMatchObject({ allowed: false });
    expect(await quota.check()).toMatchObject({ allowed: false });
  });

  it("gives back only the use counted last under that id", async () => {
    await quota.record("a");
    await quota.refund("other");
    expect(JSON.parse(jar.get("q")!)).toMatchObject({ used: 1, lastUse: "a" });
    await quota.refund("a");
    const state = JSON.parse(jar.get("q")!);
    expect(state.used).toBe(0);
    expect(state.lastUse).toBeUndefined();
    await quota.refund("a");
    expect(JSON.parse(jar.get("q")!).used).toBe(0);
  });

  it("a refund keeps the window, and does nothing once it has expired or without a cookie", async () => {
    await quota.refund("a");
    expect(jar.has("q")).toBe(false);
    await quota.record("a");
    const { resetAt } = JSON.parse(jar.get("q")!);
    vi.advanceTimersByTime(HOUR);
    await quota.record("b");
    await quota.refund("b");
    expect(JSON.parse(jar.get("q")!)).toMatchObject({ used: 1, resetAt });
    await quota.record("c");
    vi.advanceTimersByTime(25 * HOUR);
    await quota.refund("c");
    expect(JSON.parse(jar.get("q")!)).toMatchObject({ used: 2, resetAt });
  });

  it("an expired window does not count a known id as already counted", async () => {
    await quota.record("a");
    vi.advanceTimersByTime(25 * HOUR);
    await quota.record("a");
    expect(JSON.parse(jar.get("q")!)).toMatchObject({ used: 1, lastUse: "a" });
  });

  it("keeps the counter in an httpOnly cookie that lives as long as the window", async () => {
    await quota.record();
    expect(lastSet).toMatchObject({ name: "q", httpOnly: true, sameSite: "lax", path: "/", maxAge: 24 * 60 * 60 });
  });
});
