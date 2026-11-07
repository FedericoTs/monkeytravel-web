import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";

/**
 * The SDK must stay out of every page's first bundle, yet an error thrown
 * before anything asked for it must still arrive. These tests pin the
 * hand-over: hooks catch early, one fetch, one init, then the SDK's own
 * handlers take over.
 */

const init = vi.fn();
const captureException = vi.fn();
const addBreadcrumb = vi.fn();
const setUser = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  init: (...a: unknown[]) => init(...a),
  captureException: (...a: unknown[]) => captureException(...a),
  addBreadcrumb: (...a: unknown[]) => addBreadcrumb(...a),
  setUser: (...a: unknown[]) => setUser(...a),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  init.mockClear();
  captureException.mockClear();
  addBreadcrumb.mockClear();
  setUser.mockClear();
  vi.resetModules();
});

describe("sentry()", () => {
  it("rejects where nothing configured it, so callers' catch blocks are the only fallback", async () => {
    const { sentry } = await import("./sentry");
    await expect(sentry()).rejects.toThrow(/not configured/);
    expect(init).not.toHaveBeenCalled();
  });

  it("fetches and initialises the SDK once, however many callers ask", async () => {
    const { configureSentry, sentry } = await import("./sentry");
    const setup = vi.fn((Sentry: typeof import("@sentry/nextjs")) => {
      Sentry.init({ dsn: "x" });
    });
    configureSentry(setup);

    const [a, b] = await Promise.all([sentry(), sentry()]);
    expect(a).toBe(b);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("reports an error thrown before the SDK was asked for, then leaves the window to the SDK", async () => {
    const { configureSentry } = await import("./sentry");
    configureSentry(() => {});
    const early = new Error("before anyone imported the SDK");
    const removed = vi.spyOn(window, "removeEventListener");

    window.dispatchEvent(new ErrorEvent("error", { error: early }));
    await flush();
    await flush();
    expect(captureException).toHaveBeenCalledWith(early, undefined);

    // Hooks are gone: later errors are the SDK's business.
    expect(removed.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["error", "unhandledrejection"])
    );
    removed.mockRestore();
  });

  it("keeps breadcrumbs and the user without fetching the SDK, and hands them over once an error fetches it", async () => {
    const { configureSentry, sentry, sentryBreadcrumb, sentryUser } = await import("./sentry");
    configureSentry(() => {});
    sentryBreadcrumb({ category: "analytics", message: "wizard_started" });
    sentryUser({ id: "u1" });
    await flush();
    expect(init).not.toHaveBeenCalled();

    await sentry();
    expect(setUser).toHaveBeenCalledWith({ id: "u1" });
    expect(addBreadcrumb).toHaveBeenCalledWith({ category: "analytics", message: "wizard_started" });

    // Once fetched, both go straight through.
    sentryBreadcrumb({ category: "analytics", message: "later" });
    expect(addBreadcrumb).toHaveBeenLastCalledWith({ category: "analytics", message: "later" });
  });
});

describe("sentryException", () => {
  it("reports the error with its context once the SDK is fetched", async () => {
    const { configureSentry, sentryException } = await import("./sentry");
    configureSentry(() => {});
    const error = new Error("load failed");
    sentryException(error, { tags: { source: "test" }, level: "warning" });
    await flush();
    await flush();
    expect(captureException).toHaveBeenCalledWith(error, { tags: { source: "test" }, level: "warning" });
  });

  it("drops the error, without throwing or rejecting, where nothing configured the SDK", async () => {
    const { sentryException } = await import("./sentry");
    expect(() => sentryException(new Error("on the server"))).not.toThrow();
    await flush();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("is how the app reports an exception outside lib/observability: no hand-written sentry().then(...)", () => {
    const files = execSync("git ls-files --cached --others --exclude-standard -- app components hooks lib", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".vitest.") && !f.startsWith("lib/observability/"));
    const handWritten = files.filter((f) =>
      /sentry\(\)\s*\.then\(\s*\(?\s*\w+\s*\)?\s*=>\s*\{?\s*\w+\.(captureException|withScope)/.test(readFileSync(f, "utf8"))
    );
    expect(handWritten).toEqual([]);
  });
});
