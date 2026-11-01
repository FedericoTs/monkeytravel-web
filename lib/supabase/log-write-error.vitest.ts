import { describe, it, expect, vi, afterEach } from "vitest";
import { logWriteError } from "./log-write-error";

describe("logWriteError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a refused write with its label", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logWriteError("page-view", { error: { message: "permission denied for table page_views" } });
    expect(log).toHaveBeenCalledWith("[page-view] write failed:", "permission denied for table page_views");
  });

  it("stays quiet when the write landed, or there is no result", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logWriteError("page-view", { error: null });
    logWriteError("page-view", undefined);
    expect(log).not.toHaveBeenCalled();
  });
});
