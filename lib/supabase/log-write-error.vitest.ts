// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { logWriteError } from "./log-write-error";

const { reportServerFailure } = vi.hoisted(() => ({ reportServerFailure: vi.fn() }));
vi.mock("@/lib/observability/server-failure", () => ({ reportServerFailure }));

const settle = async () => {
  for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("logWriteError", () => {
  afterEach(async () => {
    // Let a test's report land before the next test starts counting.
    await settle();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    reportServerFailure.mockReset();
  });

  it("logs a refused write with its label", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logWriteError("page-view", { error: { message: "permission denied for table page_views" } });
    expect(log).toHaveBeenCalledWith("[page-view] write failed:", "permission denied for table page_views");
  });

  it("stays quiet when the write landed, or there is no result", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logWriteError("page-view", { error: null });
    logWriteError("page-view", undefined);
    await settle();
    expect(log).not.toHaveBeenCalled();
    expect(reportServerFailure).not.toHaveBeenCalled();
  });

  it("on the server, reports a refused write to Sentry as a warning, grouped by its label", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logWriteError("page-view", { error: { message: "canceling statement due to statement timeout" } });
    await vi.waitFor(() =>
      expect(reportServerFailure).toHaveBeenCalledWith(
        "[page-view] write failed: canceling statement due to statement timeout",
        "warning",
        ["page-view", "write failed"],
      ),
    );
  });

  it("in a browser, only logs", async () => {
    vi.stubGlobal("window", {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    logWriteError("onboarding", { error: { message: "JWT expired" } });
    await settle();
    expect(reportServerFailure).not.toHaveBeenCalled();
  });
});
