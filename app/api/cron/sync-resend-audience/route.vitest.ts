// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The weekly sync keeps the email audience and our own opt-outs in step, for everyone.
 * The real route runs over rows answered as PostgREST answers them, at most 1,000 per
 * request, with Resend faked: past that limit people would silently never be added,
 * and their opt-outs would never reach Resend or come back from it.
 */

const s = vi.hoisted(() => ({
  users: [] as Array<Record<string, unknown>>,
  subscribers: [] as Array<Record<string, unknown>>,
  refused: {} as Record<string, string>,
  contacts: [] as Array<{ email: string; unsubscribed: boolean }>,
  hasMore: false,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  log: [] as unknown[],
}));

vi.mock("resend", () => ({
  Resend: class {
    contacts = {
      list: async () => ({ data: { data: s.contacts, has_more: s.hasMore }, error: null }),
      create: async (contact: Record<string, unknown>) => {
        s.created.push(contact);
        return { error: null };
      },
      update: async (change: Record<string, unknown>) => {
        s.updated.push(change);
        return { error: null };
      },
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q: FakeQuery) => {
      if (s.refused[q.table]) return { data: null, error: { message: s.refused[q.table] } };
      if (q.op === "update") return { data: null, error: null };
      const from = q.filters.find(([op, column]) => op === "gte" && column === "id")?.[2] as string | undefined;
      const rows = (q.table === "users" ? s.users : s.subscribers)
        .filter((row) => !from || String(row.id) >= from)
        .filter((row) => q.table !== "users" || row.email != null || !q.filters.some(([op, column]) => op === "not" && column === "email"))
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
      return { data: rows.slice(0, Math.min(q.limitTo ?? 1000, 1000)), error: null };
    });
    s.log = db.log;
    return db.client;
  },
}));

const { GET } = await import("./route");

const person = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `user-${String(i).padStart(6, "0")}`,
  email: `person${i}@mail.example.com`,
  display_name: null,
  preferred_language: "en",
  notification_settings: {},
  ...extra,
});
const sync = async () => {
  const res = await GET(new NextRequest("https://monkeytravel.app/api/cron/sync-resend-audience", { headers: { authorization: "Bearer cron" } }));
  return { status: res.status, body: (await res.json()) as { summary?: Record<string, number>; error?: string } };
};
const userUpdates = () => (s.log as FakeQuery[]).filter((q) => q.table === "users" && q.op === "update");

beforeEach(() => {
  s.users = [];
  s.subscribers = [];
  s.refused = {};
  s.contacts = [];
  s.hasMore = false;
  s.created = [];
  s.updated = [];
  s.log = [];
  vi.stubEnv("CRON_SECRET", "cron");
  vi.stubEnv("RESEND_API_KEY", "resend-for-tests");
  vi.stubEnv("RESEND_AUDIENCE_ID", "audience");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("past what one request answers", () => {
  it("adds everyone who isn't in the audience yet", async () => {
    s.users = Array.from({ length: 1200 }, (_, i) => person(i));
    const { body } = await sync();
    expect(s.created).toHaveLength(1200);
    expect(body.summary?.totalDbUsers).toBe(1200);
  });

  it("carries an opt-out to Resend for someone far down the table", async () => {
    s.users = Array.from({ length: 1200 }, (_, i) => person(i, i === 1150 ? { notification_settings: { marketingNotifications: false } } : {}));
    s.contacts = s.users.map((u) => ({ email: String(u.email), unsubscribed: false }));
    await sync();
    expect(s.updated).toEqual([{ audienceId: "audience", email: "person1150@mail.example.com", unsubscribed: true }]);
    expect(s.created).toEqual([]);
  });

  it("brings an unsubscribe back from Resend for someone far down the table", async () => {
    s.users = Array.from({ length: 1200 }, (_, i) => person(i));
    s.contacts = s.users.map((u, i) => ({ email: String(u.email), unsubscribed: i === 1150 }));
    await sync();
    const updates = userUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].value).toEqual({ notification_settings: { marketingNotifications: false } });
    expect(updates[0].filters).toContainEqual(["eq", "id", "user-001150"]);
  });

  it("reads the waitlist through to its end too", async () => {
    s.subscribers = Array.from({ length: 1100 }, (_, i) => ({ id: `sub-${String(i).padStart(6, "0")}`, email: `waitlist${i}@mail.example.com`, unsubscribed_at: i === 1050 ? "2026-01-01" : null }));
    await sync();
    expect(s.created).toHaveLength(1100);
    expect(s.created.find((c) => c.email === "waitlist1050@mail.example.com")).toMatchObject({ unsubscribed: true });
  });
});

describe("who is in the audience", () => {
  it("skips people with no address, and test addresses", async () => {
    s.users = [person(1, { email: null }), person(2, { email: "loadtest+1@mail.example.com" }), person(3, { email: "a@example.com" }), person(4)];
    await sync();
    expect(s.created.map((c) => c.email)).toEqual(["person4@mail.example.com"]);
  });

  it("adds someone already opted out as unsubscribed", async () => {
    s.users = [person(1, { notification_settings: { emailNotifications: false } })];
    await sync();
    expect(s.created[0]).toMatchObject({ email: "person1@mail.example.com", unsubscribed: true });
  });

  it("never re-subscribes someone Resend has unsubscribed", async () => {
    s.users = [person(1)];
    s.contacts = [{ email: "person1@mail.example.com", unsubscribed: true }];
    await sync();
    expect(s.created).toEqual([]);
    expect(s.updated).toEqual([]);
  });
});

describe("when it can't see everything", () => {
  it("stops when the users can't be read, and changes nothing", async () => {
    s.refused.users = "read failed";
    const { status } = await sync();
    expect(status).toBe(500);
    expect(s.created).toEqual([]);
  });

  it("stops when the waitlist can't be read", async () => {
    s.refused.email_subscribers = "read failed";
    expect((await sync()).status).toBe(500);
    expect(s.created).toEqual([]);
  });

  it("refuses to sync part of an audience bigger than one page", async () => {
    s.hasMore = true;
    s.users = [person(1)];
    expect((await sync()).status).toBe(500);
    expect(s.created).toEqual([]);
  });
});
