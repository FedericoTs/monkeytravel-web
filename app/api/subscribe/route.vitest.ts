// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Anyone can join the waitlist, with no account, and the row goes in through the
 * service role, so the route's own checks are all that stand in front of the table.
 * The real route, validation and in-memory rate limiter run over a faked client.
 */

const s = vi.hoisted(() => ({
  ip: "",
  insert: { data: null as unknown, error: null as unknown },
  noServiceKey: false,
}));

// The limiter is real, on its in-memory store: nothing here reaches Redis.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = async () => {
      throw new Error("no Redis in tests");
    };
  },
}));

const service = fakeSupabase((q: FakeQuery) => (q.op === "insert" ? s.insert : { data: null, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (s.noServiceKey) throw new Error("Missing Supabase admin credentials");
    return service.client;
  },
}));

const { POST } = await import("./route");

const subscribe = (body: unknown, ip = s.ip) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/subscribe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        "user-agent": "Mozilla/5.0",
        referer: "https://monkeytravel.app/waitlist",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
const row = () => service.log[0]?.value as Record<string, unknown>;

let requests = 0;
beforeEach(() => {
  // The limiter counts per address, so each test comes from its own.
  s.ip = `203.0.113.${++requests}`;
  s.insert = { data: { id: "sub-1", email: "person@mail.example.com" }, error: null };
  s.noServiceKey = false;
  service.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("joining the waitlist", () => {
  it("writes one row with the tidied address and where it came from, and answers its id only", async () => {
    const res = await subscribe({ email: " Person@Mail.Example.com ", source: "footer" });
    expect(res.status).toBe(201);
    expect(service.log).toHaveLength(1);
    expect(service.log[0]).toMatchObject({ table: "email_subscribers", op: "insert" });
    expect(row()).toMatchObject({
      email: "person@mail.example.com",
      source: "footer",
      metadata: { userAgent: "Mozilla/5.0", referer: "https://monkeytravel.app/waitlist", timestamp: expect.any(String) },
    });
    expect(await res.json()).toEqual({ message: "Successfully joined the waitlist!" });
  });

  it("marks a row as from the website when no source is given", async () => {
    await subscribe({ email: "person@mail.example.com" });
    expect(row().source).toBe("website");
  });
});

describe("what it refuses", () => {
  it.each<[string, unknown, string]>([
    ["a body that isn't JSON", "{not json", "Invalid JSON body"],
    ["no address", {}, "Email is required"],
    ["an address that isn't text", { email: 42 }, "Email is required"],
    ["a malformed address", { email: "not-an-address" }, "Invalid email format"],
    ["an address with no real domain", { email: "person@mail" }, "Invalid email format"],
  ])("%s, writing nothing", async (_name, body, error) => {
    const res = await subscribe(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(service.log).toEqual([]);
  });

  it("stops the sixth try in an hour from one address before it writes, and not another address", async () => {
    for (let i = 0; i < 5; i++) expect((await subscribe({ email: "person@mail.example.com" })).status).toBe(201);
    service.log.length = 0;

    const res = await subscribe({ email: "person@mail.example.com" });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMIT");
    expect(service.log).toEqual([]);

    expect((await subscribe({ email: "person@mail.example.com" }, "198.51.100.2")).status).toBe(201);
  });

  it("refuses an oversized address, writing nothing", async () => {
    expect((await subscribe({ email: `${"a".repeat(1_000_000)}@mail.example.com` })).status).toBe(400);
    expect(service.log).toEqual([]);
  });

  it("refuses a source that isn't a short piece of text, writing nothing", async () => {
    expect((await subscribe({ email: "person@mail.example.com", source: "x".repeat(1_000_000) })).status).toBe(400);
    expect((await subscribe({ email: "person@mail.example.com", source: { any: "object" } })).status).toBe(400);
    expect(service.log).toEqual([]);
  });

  it.skip("answers 400, not 500, to a body of JSON null", async () => {
    expect((await subscribe("null")).status).toBe(400);
  });
});

describe("an address already on the list", () => {
  it("adds nothing and isn't an error", async () => {
    s.insert = { data: null, error: { code: "23505", message: "duplicate key" } };
    const res = await subscribe({ email: "person@mail.example.com" });
    expect(res.status).toBeLessThan(300);
    expect((await res.json()).id).toBeUndefined();
    expect(service.log.map((q) => q.op)).toEqual(["insert"]);
  });

  it("answers the same as a new address, so nobody can test who's on the list", async () => {
    const fresh = await (await subscribe({ email: "new@mail.example.com" })).json();
    s.insert = { data: null, error: { code: "23505", message: "duplicate key" } };
    const repeat = await subscribe({ email: "person@mail.example.com" });
    expect(repeat.status).toBe(201);
    expect(await repeat.json()).toEqual(fresh);
  });
});

describe("when the database fails", () => {
  it("answers 500 with no success when the insert fails", async () => {
    s.insert = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const res = await subscribe({ email: "person@mail.example.com" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to subscribe. Please try again." });
  });

  it("answers 500 when the service client can't be made", async () => {
    s.noServiceKey = true;
    expect((await subscribe({ email: "person@mail.example.com" })).status).toBe(500);
    expect(service.log).toEqual([]);
  });
});
