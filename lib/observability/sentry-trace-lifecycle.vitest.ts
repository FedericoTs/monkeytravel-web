import { describe, it, expect, vi, beforeEach } from "vitest";

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
});
