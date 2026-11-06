// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Every visitor's first page asks whether the site is in maintenance. The answer
 * rarely changes, so the CDN keeps it for a while, and changing it drops the
 * kept copy so the switch still takes effect at once.
 */

const s = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  readError: null as { message: string } | null,
  writeError: null as { message: string } | null,
  refused: false,
  log: [] as unknown[],
  serviceLog: [] as unknown[],
  purged: [] as string[],
  purgeFails: false,
}));

vi.mock("@vercel/functions", () => ({
  dangerouslyDeleteByTag: async (tag: string) => {
    s.purged.push(tag);
    if (s.purgeFails) throw new Error("purge failed");
  },
}));

const db = (log: "log" | "serviceLog" = "log") =>
  fakeSupabase((q: FakeQuery) => {
    s[log].push(q);
    if (q.op === "update") return { data: s.writeError ? null : s.row, error: s.writeError };
    return { data: s.readError ? null : s.row, error: s.readError };
  }).client;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db("serviceLog") }));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () =>
    s.refused
      ? { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
      : { user: { id: "admin-1", email: "admin@mail.example.com" }, supabase: db(), errorResponse: null },
}));

const { GET, PATCH } = await import("./route");

const patch = (body: unknown) =>
  PATCH(
    new NextRequest("https://monkeytravel.app/api/admin/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
const updates = () => (s.serviceLog as FakeQuery[]).filter((q) => q.op === "update");

beforeEach(() => {
  s.row = {
    id: 1,
    maintenance_mode: false,
    maintenance_message: "Back soon",
    maintenance_title: "Down",
    maintenance_started_at: null,
    allowed_emails: ["someone@mail.example.com"],
    updated_at: "2026-01-01T00:00:00Z",
    updated_by: "admin-1",
  };
  s.readError = null;
  s.writeError = null;
  s.refused = false;
  s.log = [];
  s.serviceLog = [];
  s.purged = [];
  s.purgeFails = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("reading the config", () => {
  it("answers only the maintenance fields, never who is allowed in", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({
      maintenance_mode: false,
      maintenance_message: "Back soon",
      maintenance_title: "Down",
      maintenance_started_at: null,
    });
  });

  it("asks the database for those fields alone: visitors can't read the rest", async () => {
    await GET();
    expect((s.log as FakeQuery[])[0].columns).toBe("maintenance_mode, maintenance_message, maintenance_title, maintenance_started_at");
  });

  it("lets the CDN keep it for 10 minutes, under a tag that can drop it", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=600, stale-while-revalidate=3600");
    expect(res.headers.get("Vercel-Cache-Tag")).toBe("site-config");
  });

  it("answers 'not in maintenance' when it can't read, and doesn't let the CDN keep that", async () => {
    s.readError = { message: "read failed" };
    const res = await GET();
    expect((await res.json()).maintenance_mode).toBe(false);
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
  });
});

describe("changing the config", () => {
  it("drops the CDN's copy, so the switch takes effect at once", async () => {
    const res = await patch({ maintenance_mode: true });
    expect(res.status).toBe(200);
    expect(updates()).toHaveLength(1);
    expect(s.log).toEqual([]);
    expect(s.purged).toEqual(["site-config"]);
  });

  it("still succeeds when the copy can't be dropped", async () => {
    s.purgeFails = true;
    expect((await patch({ maintenance_mode: true })).status).toBe(200);
    expect(console.error).toHaveBeenCalled();
  });

  it("leaves the copy alone when the change failed", async () => {
    s.writeError = { message: "write failed" };
    expect((await patch({ maintenance_mode: true })).status).toBe(500);
    expect(s.purged).toEqual([]);
  });

  it("refuses anyone but an admin, changing nothing", async () => {
    s.refused = true;
    expect((await patch({ maintenance_mode: true })).status).toBe(403);
    expect(updates()).toEqual([]);
    expect(s.purged).toEqual([]);
  });
});
