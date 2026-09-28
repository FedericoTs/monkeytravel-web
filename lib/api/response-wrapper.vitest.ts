import { describe, it, expect, vi, afterEach } from "vitest";
import { apiError, errors } from "./response-wrapper";

afterEach(() => vi.restoreAllMocks());

const spies = () => ({
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
});

describe("apiError logging", () => {
  it("logs a client state (4xx) as a warning, not an error", async () => {
    const s = spies();
    const res = errors.gone("This invite has expired", "EXPIRED");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "This invite has expired", code: "EXPIRED" });
    expect(s.warn).toHaveBeenCalledOnce();
    expect(s.error).not.toHaveBeenCalled();
  });

  it("logs a failure of ours (5xx) as an error", () => {
    const s = spies();
    errors.internal("Failed to join trip", "Invites");
    expect(s.error).toHaveBeenCalledWith("[Invites] Error (500):", "Failed to join trip");
    expect(s.warn).not.toHaveBeenCalled();
  });

  it("stays silent when asked", () => {
    const s = spies();
    apiError("quiet", { status: 400, log: false });
    expect(s.error).not.toHaveBeenCalled();
    expect(s.warn).not.toHaveBeenCalled();
  });
});
