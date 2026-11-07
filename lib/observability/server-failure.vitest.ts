import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { captureMessage, flush, after } = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  flush: vi.fn(async () => true),
  after: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage, flush }));
vi.mock("next/server", () => ({ after }));

const load = async () => (await import("./server-failure")).reportServerFailure;
const outsideARequest = () =>
  after.mockImplementation(() => {
    throw new Error("`after` was called outside a request scope");
  });
const settle = async () => {
  for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  vi.resetModules();
  captureMessage.mockReset();
  flush.mockClear();
  after.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("reportServerFailure", () => {
  it("sends the failure with its level and grouping, then flushes", async () => {
    outsideARequest();
    const report = await load();
    report("[Explore] Failed to fetch trips", "error", ["[Explore]", "Failed to fetch trips"]);
    await settle();
    expect(captureMessage).toHaveBeenCalledWith("[Explore] Failed to fetch trips", {
      level: "error",
      fingerprint: ["[Explore]", "Failed to fetch trips"],
    });
    expect(flush).toHaveBeenCalledOnce();
  });

  it("inside a request, waits until the response is sent", async () => {
    let scheduled: (() => Promise<void>) | undefined;
    after.mockImplementation((task: () => Promise<void>) => {
      scheduled = task;
    });
    const report = await load();
    report("[page-view] write failed: timeout", "warning", ["page-view", "write failed"]);
    await settle();
    expect(captureMessage).not.toHaveBeenCalled();
    await scheduled!();
    expect(captureMessage).toHaveBeenCalledWith("[page-view] write failed: timeout", {
      level: "warning",
      fingerprint: ["page-view", "write failed"],
    });
  });

  it("sends each kind once a minute, and other kinds meanwhile", async () => {
    outsideARequest();
    const report = await load();
    report("[A] down", "error", ["[A]", "down"], 0);
    report("[A] down", "error", ["[A]", "down"], 0);
    report("[B] down", "error", ["[B]", "down"], 0);
    report("[A] down", "error", ["[A]", "down"], 59_000);
    report("[A] down", "error", ["[A]", "down"], 61_000);
    await vi.waitFor(() => expect(captureMessage).toHaveBeenCalledTimes(3));
    await settle();
    expect(captureMessage.mock.calls.map((call) => call[0]).sort()).toEqual(["[A] down", "[A] down", "[B] down"]);
  });

  it("never throws, even when the SDK does", async () => {
    outsideARequest();
    captureMessage.mockImplementation(() => {
      throw new Error("no DSN");
    });
    const report = await load();
    expect(() => report("[X] down", "error", ["[X]", "down"])).not.toThrow();
    await settle();
    expect(captureMessage).toHaveBeenCalledOnce();
  });

  it("loads the SDK again when loading it failed", async () => {
    outsideARequest();
    vi.doMock("@sentry/nextjs", () => {
      throw new Error("chunk failed to load");
    });
    const report = await load();
    report("[A] down", "error", ["[A]", "down"]);
    await settle();
    expect(captureMessage).not.toHaveBeenCalled();
    vi.doMock("@sentry/nextjs", () => ({ captureMessage, flush }));
    report("[B] down", "error", ["[B]", "down"]);
    await vi.waitFor(() => expect(captureMessage).toHaveBeenCalledOnce());
    expect(captureMessage.mock.calls[0][0]).toBe("[B] down");
  });
});
