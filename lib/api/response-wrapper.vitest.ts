import { describe, it, expect, vi, afterEach } from "vitest";
import { apiError, errors } from "./response-wrapper";

const { reportServerFailure } = vi.hoisted(() => ({ reportServerFailure: vi.fn() }));
vi.mock("@/lib/observability/server-failure", () => ({ reportServerFailure }));

afterEach(() => {
  vi.restoreAllMocks();
  reportServerFailure.mockReset();
});

describe("apiError reporting", () => {
  it("reports a failure of ours (5xx) to Sentry, grouped by category and message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    errors.internal("Failed to fetch trips", "Explore");
    expect(reportServerFailure).toHaveBeenCalledOnce();
    expect(reportServerFailure).toHaveBeenCalledWith("[Explore] Failed to fetch trips", "error", [
      "[Explore]",
      "Failed to fetch trips",
    ]);
  });

  it("reports an uncategorised 5xx under [API]", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiError("Upstream failed", { status: 502 });
    expect(reportServerFailure).toHaveBeenCalledWith("[API] Upstream failed", "error", ["[API]", "Upstream failed"]);
  });

  it("doesn't report a client state (4xx)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    errors.notFound();
    errors.rateLimit();
    expect(reportServerFailure).not.toHaveBeenCalled();
  });

  it("doesn't report a 503: a switched-off service, or the model outage the AI code reports itself", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    errors.serviceUnavailable("Places API is currently disabled");
    errors.modelOutage();
    expect(reportServerFailure).not.toHaveBeenCalled();
  });

  it("doesn't report when asked to stay silent", () => {
    apiError("quiet", { status: 500, log: false });
    expect(reportServerFailure).not.toHaveBeenCalled();
  });
});

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
