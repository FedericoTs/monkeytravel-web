/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The planner field is kept where it says something: on step-1 heartbeats the
 * field the session was on last, on abandoned rows the one it touched last. A
 * name the list doesn't know lands without it, and other steps never carry it.
 */

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

const { POST } = await import("./route");
const post = (body: unknown) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/wizard-event", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: "mt_session_id=e2eprobe-field-test" },
    })
  );

beforeEach(() => {
  inserted.length = 0;
});

describe("field", () => {
  it("is kept on a step-1 heartbeat and on an abandoned row", async () => {
    expect((await post({ step: "step1_heartbeat", locale: "en", field: "start_date", destination: "Lisbon, Portugal" })).status).toBe(204);
    expect(inserted[0]).toMatchObject({ step: "step1_heartbeat", field: "start_date", destination: "Lisbon, Portugal" });
    expect((await post({ step: "abandoned", field: "destination_autocomplete" })).status).toBe(204);
    expect(inserted[1]).toMatchObject({ step: "abandoned", field: "destination_autocomplete" });
  });

  it("lands without a name the planner doesn't have", async () => {
    expect((await post({ step: "step1_heartbeat", field: "favourite_colour" })).status).toBe(204);
    expect(inserted[0]).toMatchObject({ step: "step1_heartbeat", field: null });
  });

  it("isn't kept on any other step", async () => {
    expect((await post({ step: "result", field: "vibe" })).status).toBe(204);
    expect(inserted[0]?.field).toBeNull();
  });
});
