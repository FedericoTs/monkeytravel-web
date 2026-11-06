// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * An admin gives someone early access by naming their email and a tester code.
 * The real route and auth helpers run over faked Supabase clients. Everything
 * past the admin check uses the service role, which ignores RLS, so a refusal
 * has to come before that client is touched at all.
 */

const ADMIN = { id: "admin-1", email: "admin@mail.example.com" };
const PERSON = { id: "person-1", email: "person@mail.example.com", display_name: "Pat" };
const CODE = {
  id: "code-1",
  code: "BETA2026",
  is_active: true,
  ai_generations_limit: 5,
  ai_regenerations_limit: 10,
  ai_assistant_limit: 20,
  expires_at: "2099-01-01T00:00:00Z",
  max_uses: null as number | null,
  current_uses: 0,
};
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };
const REFUSED = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
const FAILED = { message: "write failed" };

type Answer = { data: unknown; error: unknown };

const s = vi.hoisted(() => ({
  signedIn: null as { id: string; email: string } | null,
  accountRead: null as { data: unknown; error: unknown } | null,
  access: null as { data: unknown; error: unknown } | null,
  codeRead: null as { data: unknown; error: unknown } | null,
  code: null as Record<string, unknown> | null,
  grantError: null as unknown,
  insertError: null as unknown,
}));

/** The service-role client: rows are found by the filters the route really sent. */
const service = fakeSupabase((q: FakeQuery): Answer => {
  switch (q.table) {
    case "users":
      if (s.accountRead) return s.accountRead;
      return eqOf(q, "email") === PERSON.email ? { data: PERSON, error: null } : NO_ROW;
    case "user_tester_access":
      if (q.op === "insert") return { data: null, error: s.insertError };
      return s.access ?? NO_ROW;
    case "tester_codes":
      if (s.codeRead) return s.codeRead;
      return s.code && eqOf(q, "code") === s.code.code && eqOf(q, "is_active") === s.code.is_active
        ? { data: s.code, error: null }
        : NO_ROW;
    case "admin_grant_early_access":
      return { data: "access-1", error: s.grantError };
    default:
      return { data: null, error: null };
  }
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: s.signedIn }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => service.client }));

const { GET, POST } = await import("./route");

const URL_BASE = "https://monkeytravel.app/api/admin/grant-access";
const GRANT = { user_email: PERSON.email, code: CODE.code };
const post = (body: unknown) =>
  POST(
    new Request(URL_BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
const check = (query = `?email=${encodeURIComponent(PERSON.email)}`) => GET(new Request(`${URL_BASE}${query}`));
const writes = () => service.log.filter((q) => q.op !== "select");
const grants = writes;

beforeEach(() => {
  s.signedIn = ADMIN;
  s.accountRead = null;
  s.access = null;
  s.codeRead = null;
  s.code = { ...CODE };
  s.grantError = null;
  s.insertError = null;
  service.log.length = 0;
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may use it", () => {
  it("refuses someone signed out, before using the service role", async () => {
    s.signedIn = null;
    expect((await post(GRANT)).status).toBe(401);
    expect((await check()).status).toBe(401);
    expect(service.log).toEqual([]);
  });

  it("refuses a signed-in person who isn't an admin, before using the service role", async () => {
    s.signedIn = { id: PERSON.id, email: PERSON.email };
    expect((await post(GRANT)).status).toBe(403);
    expect((await check()).status).toBe(403);
    expect(service.log).toEqual([]);
  });
});

describe("granting access", () => {
  it("grants through the database function, with the code's limits and the admin's id", async () => {
    const res = await post({ user_email: " Person@Mail.Example.com ", code: " beta2026 " });
    expect(res.status).toBe(200);
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({
      table: "admin_grant_early_access",
      value: {
        p_user_id: PERSON.id,
        p_code_id: CODE.id,
        p_code_used: CODE.code,
        p_ai_generations_limit: 5,
        p_ai_regenerations_limit: 10,
        p_ai_assistant_limit: 20,
        p_expires_at: CODE.expires_at,
        p_granted_by: ADMIN.id,
      },
    });
    expect(await res.json()).toEqual({
      success: true,
      message: `Early access granted to ${PERSON.email}`,
      user: { id: PERSON.id, email: PERSON.email, name: PERSON.display_name },
      code: CODE.code,
      limits: { generations: 5, regenerations: 10, assistant: 20 },
      expires_at: CODE.expires_at,
    });
  });

  it("falls back to a direct insert with nothing used yet when the function refuses", async () => {
    s.grantError = FAILED;
    expect((await post(GRANT)).status).toBe(200);
    expect(grants().map((q) => [q.table, q.value])).toEqual([
      ["admin_grant_early_access", expect.anything()],
      [
        "user_tester_access",
        {
          user_id: PERSON.id,
          code_id: CODE.id,
          code_used: CODE.code,
          ai_generations_limit: 5,
          ai_generations_used: 0,
          ai_regenerations_limit: 10,
          ai_regenerations_used: 0,
          ai_assistant_limit: 20,
          ai_assistant_used: 0,
          expires_at: CODE.expires_at,
        },
      ],
    ]);
  });

  it("answers 500 and counts no use when neither the function nor the insert worked", async () => {
    s.grantError = FAILED;
    s.insertError = FAILED;
    const res = await post(GRANT);
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBeUndefined();
  });
});

describe("what it refuses", () => {
  it.each<[string, unknown, string]>([
    ["no email", { code: CODE.code }, "User email is required"],
    ["no code", { user_email: PERSON.email }, "Code is required"],
    ["a body that isn't JSON", "{not json", "Invalid JSON body"],
  ])("answers 400 to %s, reading nothing", async (_name, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(service.log).toEqual([]);
  });

  it("tells a missing account from a read the database refused, writing nothing either way", async () => {
    expect((await post({ ...GRANT, user_email: "nobody@mail.example.com" })).status).toBe(404);
    s.accountRead = REFUSED;
    expect((await post(GRANT)).status).toBe(500);
    expect(writes()).toEqual([]);
  });

  it("never grants a second time: not with access in place, nor when that can't be read", async () => {
    s.access = { data: { code_used: "OLDCODE1", redeemed_at: "2026-01-01" }, error: null };
    const res = await post(GRANT);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("OLDCODE1");

    s.access = REFUSED;
    expect((await post(GRANT)).status).toBe(500);
    expect(writes()).toEqual([]);
  });

  it("refuses an unknown or inactive code, writing nothing", async () => {
    expect((await post({ ...GRANT, code: "NOSUCHCODE" })).status).toBe(400);
    s.code = { ...CODE, is_active: false };
    expect((await post(GRANT)).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("refuses a code past its expiry, granting nothing", async () => {
    s.code = { ...CODE, expires_at: "2020-01-01T00:00:00Z" };
    expect((await post(GRANT)).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("refuses a code with no uses left, granting nothing", async () => {
    s.code = { ...CODE, max_uses: 3, current_uses: 3 };
    expect((await post(GRANT)).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("takes a code with one use left", async () => {
    s.code = { ...CODE, max_uses: 3, current_uses: 2 };
    expect((await post(GRANT)).status).toBe(200);
  });

  it("leaves the count to the access row's trigger, so a grant is one use, not two", async () => {
    await post(GRANT);
    expect(writes().map((q) => q.table)).toEqual(["admin_grant_early_access"]);
  });

  it("answers 500, not 'invalid code', when the code read is refused", async () => {
    s.codeRead = REFUSED;
    expect((await post(GRANT)).status).toBe(500);
  });

  it("answers 400, not 500, to an email or code that isn't text, or a body of JSON null", async () => {
    expect((await post({ user_email: 42, code: CODE.code })).status).toBe(400);
    expect((await post({ user_email: PERSON.email, code: 42 })).status).toBe(400);
    expect((await post("null")).status).toBe(400);
  });
});

describe("checking someone's access", () => {
  it("answers with their access row, looked up by the tidied address", async () => {
    const row = { user_id: PERSON.id, code_used: CODE.code };
    s.access = { data: row, error: null };
    const res = await check(`?email=${encodeURIComponent(" Person@Mail.Example.com ")}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: PERSON.id, email: PERSON.email, name: PERSON.display_name },
      hasAccess: true,
      access: row,
    });
  });

  it("says no access when there is none, but 500 when it can't be read, and needs an email", async () => {
    expect(await (await check()).json()).toMatchObject({ hasAccess: false, access: null });
    s.access = REFUSED;
    expect((await check()).status).toBe(500);
    expect((await check("")).status).toBe(400);
    expect(writes()).toEqual([]);
  });
});
