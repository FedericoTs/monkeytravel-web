// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Who may pass during maintenance: admins, emails on the list, and testers whose
 * access hasn't expired. The list isn't readable with a visitor's own session, so it
 * goes through the service role. A failed lookup means no bypass from that rule.
 */

const s = vi.hoisted(() => ({
  email: null as string | null,
  admin: false,
  allowed: [] as string[],
  listError: null as { message: string } | null,
  listReads: [] as string[],
  tester: null as { id: string; expires_at: string | null } | null,
}));

vi.mock("@/lib/admin", () => ({ isAdmin: () => s.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...fakeSupabase(() => ({ data: s.tester, error: s.tester ? null : { code: "PGRST116", message: "no rows" } })).client,
    auth: { getUser: async () => ({ data: { user: s.email ? { id: "u-1", email: s.email } : null } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    fakeSupabase((q: FakeQuery) => {
      s.listReads.push(q.table);
      return { data: s.listError ? null : { allowed_emails: s.allowed }, error: s.listError };
    }).client,
}));

const { GET } = await import("./route");
const bypass = async () => ((await (await GET()).json()) as { bypass: boolean }).bypass;

beforeEach(() => {
  s.email = "someone@mail.example.com";
  s.admin = false;
  s.allowed = [];
  s.listError = null;
  s.listReads = [];
  s.tester = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/auth/maintenance-bypass", () => {
  it("gives nobody signed out a bypass, without reading the list", async () => {
    s.email = null;
    expect(await bypass()).toBe(false);
    expect(s.listReads).toEqual([]);
  });

  it("lets an admin through, without reading the list", async () => {
    s.admin = true;
    expect(await bypass()).toBe(true);
    expect(s.listReads).toEqual([]);
  });

  it("reads the list with the service role, and lets someone on it through, whatever the case", async () => {
    s.allowed = ["Someone@Mail.Example.com"];
    expect(await bypass()).toBe(true);
    expect(s.listReads).toEqual(["site_config"]);
  });

  it("matches however the person's address is written", async () => {
    s.email = "Someone@Mail.Example.COM";
    s.allowed = ["someone@mail.example.com"];
    expect(await bypass()).toBe(true);
  });

  it("keeps out someone who isn't on it", async () => {
    s.allowed = ["other@mail.example.com"];
    expect(await bypass()).toBe(false);
  });

  it("lets a tester through while their access lasts", async () => {
    s.tester = { id: "t-1", expires_at: "2999-01-01T00:00:00Z" };
    expect(await bypass()).toBe(true);
  });

  it("keeps out a tester whose access has expired", async () => {
    s.tester = { id: "t-1", expires_at: "2000-01-01T00:00:00Z" };
    expect(await bypass()).toBe(false);
  });

  it("falls through to the tester check when the list can't be read", async () => {
    s.listError = { message: "read failed" };
    s.tester = { id: "t-1", expires_at: null };
    expect(await bypass()).toBe(true);
  });
});
