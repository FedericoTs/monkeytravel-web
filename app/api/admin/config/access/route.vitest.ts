// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The Access tab has to see who may pass during maintenance, and only it: this is
 * the one read of that list, for admins, and the CDN never keeps it.
 */

const s = vi.hoisted(() => ({
  refused: false,
  error: null as { message: string } | null,
  log: [] as unknown[],
}));

const ROW = {
  id: 1,
  maintenance_mode: false,
  maintenance_message: "Back soon",
  maintenance_title: "Down",
  maintenance_started_at: null,
  allowed_emails: ["someone@mail.example.com"],
};

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () =>
    s.refused
      ? { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
      : { user: { id: "admin-1" }, errorResponse: null },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    fakeSupabase((q: FakeQuery) => {
      s.log.push(q);
      return { data: s.error ? null : ROW, error: s.error };
    }).client,
}));

const { GET } = await import("./route");

beforeEach(() => {
  s.refused = false;
  s.error = null;
  s.log = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/config/access", () => {
  it("gives an admin the whole config, list included", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ROW);
  });

  it("is never kept by a cache", async () => {
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses anyone else, without reading", async () => {
    s.refused = true;
    expect((await GET()).status).toBe(403);
    expect(s.log).toEqual([]);
  });

  it("answers 500 when it can't read, rather than an empty list that Save would write back", async () => {
    s.error = { message: "read failed" };
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("allowed_emails");
  });
});
