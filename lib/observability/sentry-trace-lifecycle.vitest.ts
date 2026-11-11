import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

/**
 * The server and edge SDKs send spans as one transaction per request. The
 * SDK's default since v11 streams them instead, and the tracing views and
 * sampling here are set up for transactions.
 */

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ init }));

describe("server and edge tracing", () => {
  beforeEach(() => {
    init.mockClear();
    vi.resetModules();
  });

  it("the server SDK sends whole transactions", async () => {
    await import("../../sentry.server.config");
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toMatchObject({ traceLifecycle: "static" });
  });

  it("the edge SDK sends whole transactions", async () => {
    await import("../../sentry.edge.config");
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toMatchObject({ traceLifecycle: "static" });
  });

  it("server and edge messages are titled by their text, not by the helper that sends them", async () => {
    await import("../../sentry.server.config");
    await import("../../sentry.edge.config");
    expect(init).toHaveBeenCalledTimes(2);
    for (const [options] of init.mock.calls) expect(options).toMatchObject({ attachStacktrace: false });
  });

  it("the build keeps the tracing code in the server and edge bundles", () => {
    // withSentryConfig turns excludeTracing into a build-time define that
    // Next.js applies to every bundle, server and edge included, so with it
    // nothing on the server is ever sampled.
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).not.toMatch(/excludeTracing:\s*true/);
  });
});
