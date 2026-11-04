// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A failed assistant request reports how long it ran: in the logs and in
 * Sentry, a timeout must not read like an instant failure.
 */

const SPENT_MS = 1500;

const recordAiOutcome = vi.fn();
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: (outcome: unknown) => recordAiOutcome(outcome) }));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => {
    vi.setSystemTime(Date.now() + SPENT_MS);
    throw new Error("auth down");
  },
}));

const request = () => new NextRequest("http://localhost/api/ai/assistant", { method: "POST", body: "{}" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  recordAiOutcome.mockReset();
});

describe("assistant failures report their duration", () => {
  it.each([
    ["the turn", () => import("./route"), undefined],
    ["apply", () => import("./apply/route"), { subroute: "apply" }],
    ["undo", () => import("./undo/route"), { subroute: "undo" }],
  ])("%s", async (_name, load, metadata) => {
    const { POST } = await load();
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(recordAiOutcome).toHaveBeenCalledTimes(1);
    expect(recordAiOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "assistant",
        outcome: "failure",
        durationMs: SPENT_MS,
        ...(metadata ? { metadata } : {}),
      })
    );
  });
});
