// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Admins list, create, change and delete tester codes. A code is what stands
 * between a person and its AI limits, so nobody else may reach any of this. The
 * real route and auth helpers run over a faked Supabase client.
 */

const ADMIN = { id: "admin-1", email: "admin@mail.example.com" };
const PERSON = { id: "person-1", email: "person@mail.example.com" };
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };
const REFUSED = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
const FAILED = { message: "write failed" };

const s = vi.hoisted(() => ({
  signedIn: null as { id: string; email: string } | null,
  list: { data: [] as unknown, error: null as unknown },
  usage: { data: [] as unknown, error: null as unknown },
  existing: null as { data: unknown; error: unknown } | null,
  insertError: null as unknown,
  updated: null as { data: unknown; error: unknown } | null,
  accessDeleteError: null as unknown,
  codeDeleteError: null as unknown,
}));

const db = fakeSupabase((q: FakeQuery) => {
  if (q.table === "user_tester_access") {
    return q.op === "delete" ? { data: null, error: s.accessDeleteError } : s.usage;
  }
  if (q.op === "select") return q.end === "list" ? s.list : (s.existing ?? NO_ROW);
  if (q.op === "insert") return { data: s.insertError ? null : q.value, error: s.insertError };
  if (q.op === "update") return s.updated ?? { data: { id: eqOf(q, "id"), ...(q.value as object) }, error: null };
  if (q.op === "delete") return { data: null, error: s.codeDeleteError };
  return { data: null, error: null };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...db.client, auth: { getUser: async () => ({ data: { user: s.signedIn }, error: null }) } }),
}));

const { DELETE, GET, PATCH, POST } = await import("./route");

const URL_BASE = "https://monkeytravel.app/api/admin/access-codes";
const json = (method: string, body: unknown) =>
  new Request(URL_BASE, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const create = (body: unknown) => POST(json("POST", body));
const change = (body: unknown) => PATCH(json("PATCH", body));
const remove = (id?: string) => DELETE(new Request(`${URL_BASE}${id ? `?id=${id}` : ""}`, { method: "DELETE" }));
const writes = () => db.log.filter((q) => q.op !== "select");

beforeEach(() => {
  s.signedIn = ADMIN;
  s.list = { data: [], error: null };
  s.usage = { data: [], error: null };
  s.existing = null;
  s.insertError = null;
  s.updated = null;
  s.accessDeleteError = null;
  s.codeDeleteError = null;
  db.log.length = 0;
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may use it", () => {
  const everyVerb = () => [GET(), create({ code: "VALID1" }), change({ id: "code-1", is_active: false }), remove("code-1")];

  it("refuses someone signed out on every verb, touching nothing", async () => {
    s.signedIn = null;
    const answers = await Promise.all(everyVerb());
    expect(answers.map((res) => res.status)).toEqual([401, 401, 401, 401]);
    expect(db.log).toEqual([]);
  });

  it("refuses a signed-in person who isn't an admin on every verb, touching nothing", async () => {
    s.signedIn = PERSON;
    const answers = await Promise.all(everyVerb());
    expect(answers.map((res) => res.status)).toEqual([403, 403, 403, 403]);
    expect(db.log).toEqual([]);
  });
});

describe("listing the codes", () => {
  it("adds each code's usage up, and shows zeros for a code nobody redeemed", async () => {
    s.list = { data: [{ id: "code-1" }, { id: "code-2" }], error: null };
    s.usage = {
      data: [
        { code_id: "code-1", ai_generations_used: 2, ai_regenerations_used: 1, ai_assistant_used: null },
        { code_id: "code-1", ai_generations_used: 3, ai_regenerations_used: 0, ai_assistant_used: 4 },
      ],
      error: null,
    };
    expect(await (await GET()).json()).toEqual({
      codes: [
        { id: "code-1", usage: { generations: 5, regenerations: 1, assistant: 4 } },
        { id: "code-2", usage: { generations: 0, regenerations: 0, assistant: 0 } },
      ],
    });
  });

  it("answers 500 when the codes can't be read", async () => {
    s.list = REFUSED;
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).codes).toBeUndefined();
  });
});

describe("creating a code", () => {
  it("writes the settings given, under the upper-cased code, as the signed-in admin's", async () => {
    const res = await create({
      code: " vip2030 ",
      display_name: "Press",
      ai_generations_limit: 0,
      ai_regenerations_limit: 5,
      ai_assistant_limit: 6,
      max_uses: 7,
      expires_at: "2099-01-01T00:00:00Z",
      notes: "for reviewers",
      created_by: "someone-else",
      is_active: false,
    });
    expect(res.status).toBe(200);
    expect(writes().map((q) => [q.table, q.op, q.value])).toEqual([
      [
        "tester_codes",
        "insert",
        {
          code: "VIP2030",
          display_name: "Press",
          ai_generations_limit: 0,
          ai_regenerations_limit: 5,
          ai_assistant_limit: 6,
          max_uses: 7,
          expires_at: "2099-01-01T00:00:00Z",
          notes: "for reviewers",
          created_by: ADMIN.id,
          is_active: true,
        },
      ],
    ]);
    expect((await res.json()).success).toBe(true);
  });

  it("makes up a code that's easy to read aloud when none is given", async () => {
    expect((await create({})).status).toBe(200);
    expect((writes()[0].value as { code: string }).code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it("refuses a code too short, too long or with symbols, and a body that isn't JSON, touching nothing", async () => {
    for (const code of ["ABC", "A".repeat(21), "BAD-CODE!"]) expect((await create({ code })).status).toBe(400);
    expect((await create("{not json")).status).toBe(400);
    expect(db.log).toEqual([]);
  });

  it("refuses a code that already exists, and writes nothing when it can't tell", async () => {
    s.existing = { data: { id: "code-1" }, error: null };
    const res = await create({ code: "TAKEN1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Code already exists");

    s.existing = REFUSED;
    expect((await create({ code: "VALID1" })).status).toBe(500);
    expect(writes()).toEqual([]);
  });

  it("answers 500, with no code in it, when the insert fails", async () => {
    s.insertError = FAILED;
    const res = await create({ code: "VALID1" });
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("code");
  });

  it("refuses a negative limit or a malformed expiry, writing nothing", async () => {
    expect((await create({ code: "VALID1", max_uses: -1 })).status).toBe(400);
    expect((await create({ code: "VALID1", ai_generations_limit: "many" })).status).toBe(400);
    expect((await create({ code: "VALID1", expires_at: "soon" })).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("answers 400, not 500, to a code that isn't text, or a body of JSON null", async () => {
    expect((await create({ code: 12345 })).status).toBe(400);
    expect((await create("null")).status).toBe(400);
  });
});

describe("changing a code", () => {
  it("changes only the code named, and never its id", async () => {
    const res = await change({ id: "code-1", is_active: false });
    expect(res.status).toBe(200);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ table: "tester_codes", op: "update", value: { is_active: false } });
    expect(writes()[0].value).not.toHaveProperty("id");
    expect(eqOf(writes()[0], "id")).toBe("code-1");
    expect(await res.json()).toEqual({ success: true, code: { id: "code-1", is_active: false } });
  });

  it("needs an id, and answers 500 with no success when the update fails", async () => {
    expect((await change({ is_active: false })).status).toBe(400);
    expect(writes()).toEqual([]);

    s.updated = { data: null, error: FAILED };
    const res = await change({ id: "code-1", is_active: false });
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBeUndefined();
  });

  it("refuses a change to anything but a code's editable settings", async () => {
    expect((await change({ id: "code-1", current_uses: 0 })).status).toBe(400);
    expect((await change({ id: "code-1", created_by: "someone-else" })).status).toBe(400);
    expect((await change({ id: "code-1", code: "not a valid code!" })).status).toBe(400);
    expect((await change({ id: "code-1", max_uses: -1 })).status).toBe(400);
    expect((await change({ id: "code-1", expires_at: "soon" })).status).toBe(400);
    expect((await change({ id: "code-1", is_active: "yes" })).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("takes the limits, expiry and notes the page can set", async () => {
    const settings = { display_name: "Spring", ai_generations_limit: 5, ai_regenerations_limit: null, ai_assistant_limit: 0, max_uses: 10, expires_at: "2027-01-01T00:00:00Z", notes: "for the beta", is_active: true };
    expect((await change({ id: "code-1", ...settings })).status).toBe(200);
    expect(writes()[0].value).toEqual(settings);
  });

  it("answers 404, not 500, when the code doesn't exist", async () => {
    s.updated = NO_ROW;
    expect((await change({ id: "no-such-code", is_active: false })).status).toBe(404);
  });
});

describe("deleting a code", () => {
  it("removes who redeemed it first, then the code, each by that code's id", async () => {
    const res = await remove("code-1");
    expect(res.status).toBe(200);
    expect(writes().map((q) => [q.table, q.op, q.filters])).toEqual([
      ["user_tester_access", "delete", [["eq", "code_id", "code-1"]]],
      ["tester_codes", "delete", [["eq", "id", "code-1"]]],
    ]);
    expect(await res.json()).toEqual({ success: true });
  });

  it("needs an id, and deletes nothing without one", async () => {
    expect((await remove()).status).toBe(400);
    expect(db.log).toEqual([]);
  });

  it("leaves the code alone when its access rows couldn't be removed", async () => {
    s.accessDeleteError = FAILED;
    expect((await remove("code-1")).status).toBe(500);
    expect(writes().map((q) => q.table)).toEqual(["user_tester_access"]);
  });

  it("answers 500, with no success, when the code itself can't be deleted", async () => {
    s.codeDeleteError = FAILED;
    const res = await remove("code-1");
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBeUndefined();
  });
});
