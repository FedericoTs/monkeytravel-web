// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The API settings: each API's switch and daily limit, and the switch that stops them
 * all. PostgREST runs with safeupdate, which refuses an update with no filter, so this
 * fake refuses it too: without a filter that switch fails exactly when it's needed.
 */

const s = vi.hoisted(() => ({
  refused: false,
  error: null as { message: string } | null,
  log: [] as unknown[],
}));

const ROW = { api_name: "gemini", display_name: "Gemini", enabled: true, block_mode: "none", daily_limit: 500 };

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () =>
    s.refused
      ? { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
      : {
          user: { id: "admin-1" },
          errorResponse: null,
          supabase: fakeSupabase((q: FakeQuery) => {
            s.log.push(q);
            if (s.error) return { data: null, error: s.error };
            if (q.op === "update" && q.filters.length === 0) {
              return { data: null, error: { message: "UPDATE requires a WHERE clause" } };
            }
            return { data: q.end === "single" ? ROW : [ROW], error: null };
          }).client,
        },
}));

const { GET, PATCH, POST } = await import("./route");

const send = (handler: (r: NextRequest) => Promise<Response>, method: string, body: unknown) =>
  handler(
    new NextRequest("https://monkeytravel.app/api/admin/api-config", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
const updates = () => (s.log as FakeQuery[]).filter((q) => q.op === "update");
const written = () => updates()[0].value as Record<string, unknown>;

beforeEach(() => {
  s.refused = false;
  s.error = null;
  s.log = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("GET", () => {
  it("lists the APIs for an admin", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).configs).toEqual([ROW]);
  });

  it("refuses anyone else, without reading", async () => {
    s.refused = true;
    expect((await GET()).status).toBe(403);
    expect(s.log).toEqual([]);
  });

  it("answers 500 when it can't read", async () => {
    s.error = { message: "read failed" };
    expect((await GET()).status).toBe(500);
  });
});

describe("PATCH", () => {
  it("changes one API's switch, saying who did", async () => {
    const res = await send(PATCH, "PATCH", { api_name: "gemini", enabled: false, block_mode: "block_calls" });
    expect(res.status).toBe(200);
    expect(written()).toMatchObject({ enabled: false, block_mode: "block_calls", updated_by: "admin-1" });
    expect(updates()[0].filters).toContainEqual(["eq", "api_name", "gemini"]);
    expect((await res.json()).config).toEqual(ROW);
  });

  it("ignores a block mode it doesn't know", async () => {
    await send(PATCH, "PATCH", { api_name: "gemini", block_mode: "whatever" });
    expect(written().block_mode).toBeUndefined();
  });

  it("needs to know which API", async () => {
    expect((await send(PATCH, "PATCH", { enabled: false })).status).toBe(400);
    expect(updates()).toEqual([]);
  });

  it("sets a daily limit, and clears one", async () => {
    await send(PATCH, "PATCH", { api_name: "gemini", daily_limit: 800 });
    expect(written().daily_limit).toBe(800);
    s.log = [];
    await send(PATCH, "PATCH", { api_name: "gemini", daily_limit: null });
    expect(written().daily_limit).toBeNull();
  });

  it("takes 0 as a limit: it stops the API", async () => {
    await send(PATCH, "PATCH", { api_name: "gemini", daily_limit: 0 });
    expect(written().daily_limit).toBe(0);
  });

  it.each([[-1], [1.5], ["800"], [Number.MAX_SAFE_INTEGER + 2]])("refuses %s as a daily limit", async (daily_limit) => {
    expect((await send(PATCH, "PATCH", { api_name: "gemini", daily_limit })).status).toBe(400);
    expect(updates()).toEqual([]);
  });

  it("leaves the limit alone when it isn't sent", async () => {
    await send(PATCH, "PATCH", { api_name: "gemini", enabled: true });
    expect(written()).not.toHaveProperty("daily_limit");
  });

  it("answers 500 when it can't write", async () => {
    s.error = { message: "write failed" };
    expect((await send(PATCH, "PATCH", { api_name: "gemini", enabled: true })).status).toBe(500);
  });

  it("refuses anyone else, changing nothing", async () => {
    s.refused = true;
    expect((await send(PATCH, "PATCH", { api_name: "gemini", enabled: false })).status).toBe(403);
    expect(s.log).toEqual([]);
  });
});

describe("POST: stopping everything", () => {
  it("turns every API off, and the database accepts it", async () => {
    const res = await send(POST, "POST", { action: "disable_all" });
    expect(res.status).toBe(200);
    expect(written()).toMatchObject({ enabled: false, block_mode: "block_calls", updated_by: "admin-1" });
  });

  it("says so when it fails", async () => {
    s.error = { message: "write failed" };
    expect((await send(POST, "POST", { action: "disable_all" })).status).toBe(500);
  });

  it("refuses anyone else, changing nothing", async () => {
    s.refused = true;
    expect((await send(POST, "POST", { action: "disable_all" })).status).toBe(403);
    expect(s.log).toEqual([]);
  });

  it.each([["enable_all"], ["reset_daily"], ["reset_monthly"], ["whatever"]])("doesn't do %s", async (action) => {
    expect((await send(POST, "POST", { action, api_name: "gemini" })).status).toBe(400);
    expect(updates()).toEqual([]);
  });
});
