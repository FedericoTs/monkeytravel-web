// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The weekly sync keeps the email audience and our own opt-outs in step, for everyone,
 * and keeps the account under Resend's contact limit. The real route runs over rows
 * answered as PostgREST answers them, at most 1,000 per request, with Resend faked: past
 * that limit opt-outs would never reach Resend or come back from it.
 */

const s = vi.hoisted(() => ({
  users: [] as Array<Record<string, unknown>>,
  subscribers: [] as Array<Record<string, unknown>>,
  /** Last sign-in by user id, as Supabase Auth answers it. */
  signIns: {} as Record<string, string>,
  authError: null as string | null,
  refused: {} as Record<string, string>,
  userUpdateError: null as { message: string } | null,
  contacts: [] as Array<{ email: string; unsubscribed: boolean }>,
  hasMore: false,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  removed: [] as Array<Record<string, unknown>>,
  removeError: null as { message: string } | null,
  createThrows: false,
  /** Resend calls that change a contact, in order. */
  calls: [] as string[],
  log: [] as unknown[],
}));

vi.mock("resend", () => ({
  Resend: class {
    contacts = {
      list: async () => ({ data: { data: s.contacts, has_more: s.hasMore }, error: null }),
      create: async (contact: Record<string, unknown>) => {
        s.calls.push("create");
        if (s.createThrows) throw new Error("network down");
        s.created.push(contact);
        return { error: null };
      },
      update: async (change: Record<string, unknown>) => {
        s.calls.push("update");
        s.updated.push(change);
        return { error: null };
      },
      remove: async (contact: Record<string, unknown>) => {
        s.calls.push("remove");
        s.removed.push(contact);
        return { error: s.removeError };
      },
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q: FakeQuery) => {
      if (s.refused[q.table]) return { data: null, error: { message: s.refused[q.table] } };
      if (q.op === "update") return { data: null, error: s.userUpdateError };
      const from = q.filters.find(([op, column]) => op === "gte" && column === "id")?.[2] as string | undefined;
      const rows = (q.table === "users" ? s.users : s.subscribers)
        .filter((row) => !from || String(row.id) >= from)
        .filter((row) => q.table !== "users" || row.email != null || !q.filters.some(([op, column]) => op === "not" && column === "email"))
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
      return { data: rows.slice(0, Math.min(q.limitTo ?? 1000, 1000)), error: null };
    });
    s.log = db.log;
    return {
      ...db.client,
      auth: {
        admin: {
          // At most 1,000 a page, whatever is asked for.
          listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
            if (s.authError) return { data: { users: [] }, error: { message: s.authError } };
            const size = Math.min(perPage, 1000);
            const users = s.users
              .slice((page - 1) * size, page * size)
              .map((u) => ({ id: u.id, last_sign_in_at: s.signIns[String(u.id)] ?? null }));
            return { data: { users }, error: null };
          },
        },
      },
    };
  },
}));

const { GET } = await import("./route");

/** A signup date, later as the number goes up. */
const joined = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString();
const person = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `user-${String(i).padStart(6, "0")}`,
  email: `person${i}@mail.example.com`,
  display_name: null,
  preferred_language: "en",
  notification_settings: {},
  created_at: joined(0),
  ...extra,
});
const sync = async () => {
  const res = await GET(new NextRequest("https://monkeytravel.app/api/cron/sync-resend-audience", { headers: { authorization: "Bearer cron" } }));
  return {
    status: res.status,
    body: (await res.json()) as { summary?: Record<string, number>; errors?: Array<{ email: string; error: string }>; error?: string },
  };
};
const userUpdates = () => (s.log as FakeQuery[]).filter((q) => q.table === "users" && q.op === "update");

beforeEach(() => {
  s.users = [];
  s.subscribers = [];
  s.signIns = {};
  s.authError = null;
  s.refused = {};
  s.userUpdateError = null;
  s.contacts = [];
  s.hasMore = false;
  s.created = [];
  s.updated = [];
  s.removed = [];
  s.removeError = null;
  s.createThrows = false;
  s.calls = [];
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
  it("adds the newest people, from anywhere in the table, up to the ceiling", async () => {
    s.users = Array.from({ length: 1200 }, (_, i) => person(i, { created_at: joined(i) }));
    const { body } = await sync();
    expect(s.created).toHaveLength(950);
    expect(s.created[0]).toMatchObject({ email: "person1199@mail.example.com" });
    expect(s.created.at(-1)).toMatchObject({ email: "person250@mail.example.com" });
    expect(body.summary?.totalDbUsers).toBe(1200);
  });

  it("reads sign-ins past the first page of accounts", async () => {
    s.users = Array.from({ length: 1200 }, (_, i) => person(i));
    s.signIns = { "user-001150": joined(5000) };
    await sync();
    expect(s.created[0]).toMatchObject({ email: "person1150@mail.example.com" });
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
    s.subscribers = Array.from({ length: 1100 }, (_, i) => ({
      id: `sub-${String(i).padStart(6, "0")}`,
      email: `waitlist${i}@mail.example.com`,
      created_at: joined(i),
      unsubscribed_at: i === 1050 ? "2026-01-01" : null,
    }));
    await sync();
    expect(s.created).toHaveLength(950);
    expect(s.created[0]).toMatchObject({ email: "waitlist1099@mail.example.com" });
    expect(s.created.find((c) => c.email === "waitlist1050@mail.example.com")).toBeUndefined();
  });
});

describe("who is in the audience", () => {
  it("skips people with no address, and test addresses", async () => {
    s.users = [person(1, { email: null }), person(2, { email: "loadtest+1@mail.example.com" }), person(3, { email: "a@example.com" }), person(4)];
    await sync();
    expect(s.created.map((c) => c.email)).toEqual(["person4@mail.example.com"]);
  });

  it("doesn't add someone opted out", async () => {
    s.users = [
      person(1, { notification_settings: { emailNotifications: false } }),
      person(2, { notification_settings: { marketingNotifications: false } }),
    ];
    await sync();
    expect(s.created).toEqual([]);
  });

  it("doesn't add someone who left the waitlist", async () => {
    s.subscribers = [{ id: "sub-1", email: "left@mail.example.com", created_at: joined(1), unsubscribed_at: joined(2) }];
    await sync();
    expect(s.created).toEqual([]);
  });

  it("removes someone opted out from the whole account, which is what frees the slot", async () => {
    s.users = [person(1, { notification_settings: { marketingNotifications: false } })];
    s.contacts = [{ email: "person1@mail.example.com", unsubscribed: true }];
    const { body } = await sync();
    // With an audienceId, Resend only takes them out of that audience: the contact stays and still counts.
    expect(s.removed).toEqual([{ email: "person1@mail.example.com" }]);
    expect(body.summary?.removed).toBe(1);
  });

  it("flags an opt-out in Resend before removing, so a failed removal can't leave them subscribed", async () => {
    s.users = [person(1, { notification_settings: { marketingNotifications: false } })];
    s.contacts = [{ email: "person1@mail.example.com", unsubscribed: false }];
    await sync();
    expect(s.calls).toEqual(["update", "remove"]);
    expect(s.updated[0]).toMatchObject({ email: "person1@mail.example.com", unsubscribed: true });
  });

  it("removes a contact with no account or waitlist row behind it", async () => {
    s.contacts = [{ email: "gone@mail.example.com", unsubscribed: false }];
    await sync();
    expect(s.removed).toEqual([{ email: "gone@mail.example.com" }]);
  });

  it("leaves alone someone who's in the audience and hasn't opted out", async () => {
    s.users = [person(1)];
    s.contacts = [{ email: "person1@mail.example.com", unsubscribed: false }];
    await sync();
    expect(s.calls).toEqual([]);
  });

  it("records a Resend unsubscribe, then removes the contact, and never brings them back", async () => {
    s.users = [person(1)];
    s.contacts = [{ email: "person1@mail.example.com", unsubscribed: true }];
    await sync();
    const written = userUpdates()[0].value as { notification_settings: Record<string, unknown> };
    expect(written.notification_settings.marketingNotifications).toBe(false);
    expect(s.removed).toEqual([{ email: "person1@mail.example.com" }]);
    expect(s.created).toEqual([]);

    s.users = [person(1, written)];
    s.contacts = [];
    s.created = [];
    await sync();
    expect(s.created).toEqual([]);
  });

  it("keeps the contact when a Resend unsubscribe couldn't be recorded, so it isn't lost", async () => {
    s.users = [person(1)];
    s.contacts = [{ email: "person1@mail.example.com", unsubscribed: true }];
    s.userUpdateError = { message: "write failed" };
    const { body } = await sync();
    expect(s.removed).toEqual([]);
    expect(s.created).toEqual([]);
    expect(body.summary?.reverseBackSynced).toBe(0);
  });

  it("leaves a waitlist contact who unsubscribed in Resend as they are: nothing else records it", async () => {
    s.subscribers = [{ id: "sub-1", email: "w@mail.example.com", created_at: joined(1), unsubscribed_at: null }];
    s.contacts = [{ email: "w@mail.example.com", unsubscribed: true }];
    await sync();
    expect(s.calls).toEqual([]);
  });
});

describe("the ceiling", () => {
  const everyoneIn = (n: number) => {
    s.users = Array.from({ length: n }, (_, i) => person(i, { created_at: joined(i) }));
    s.contacts = s.users.map((u) => ({ email: String(u.email), unsubscribed: false }));
  };

  it("removes nobody at the ceiling", async () => {
    everyoneIn(950);
    await sync();
    expect(s.calls).toEqual([]);
  });

  it("removes whoever has been away longest, one past the ceiling", async () => {
    everyoneIn(951);
    await sync();
    expect(s.removed).toEqual([{ email: "person0@mail.example.com" }]);
    expect(s.created).toEqual([]);
  });

  it("goes by the last sign-in, so someone who came back outlasts a newer signup", async () => {
    everyoneIn(951);
    s.signIns = { "user-000000": joined(5000) };
    await sync();
    expect(s.removed).toEqual([{ email: "person1@mail.example.com" }]);
  });

  it("makes room before adding", async () => {
    everyoneIn(950);
    s.users.push(person(950, { created_at: joined(950) }));
    await sync();
    expect(s.removed).toEqual([{ email: "person0@mail.example.com" }]);
    expect(s.created.map((c) => c.email)).toEqual(["person950@mail.example.com"]);
    expect(s.calls).toEqual(["remove", "create"]);
  });

  it("doesn't count opted-out people against it", async () => {
    everyoneIn(952);
    s.users[951] = person(951, { created_at: joined(951), notification_settings: { marketingNotifications: false } });
    await sync();
    expect(s.removed).toEqual([{ email: "person0@mail.example.com" }, { email: "person951@mail.example.com" }]);
  });
});

describe("when Resend refuses or time runs out", () => {
  it("reports a removal that failed, retries nothing, and still adds people", async () => {
    s.users = [person(1), person(2, { notification_settings: { marketingNotifications: false } })];
    s.contacts = [{ email: "person2@mail.example.com", unsubscribed: true }];
    s.removeError = { message: "no such contact" };
    const { body } = await sync();
    expect(body.summary).toMatchObject({ removed: 0, failed: 1, created: 1 });
    expect(body.errors).toEqual([{ email: "person2@mail.example.com", error: "no such contact" }]);
    expect(s.calls.filter((c) => c === "remove")).toHaveLength(1);
  });

  it("reports an add that threw, and carries on", async () => {
    s.users = [person(1), person(2)];
    s.createThrows = true;
    const { status, body } = await sync();
    expect(status).toBe(200);
    expect(body.summary).toMatchObject({ created: 0, failed: 2 });
    expect(body.errors?.[0]).toEqual({ email: "person1@mail.example.com", error: "network down" });
    expect(s.calls).toEqual(["create", "create"]);
  });

  it("adds people as subscribed, to this audience", async () => {
    s.users = [person(1)];
    const { body } = await sync();
    expect(s.created).toEqual([{ email: "person1@mail.example.com", firstName: undefined, audienceId: "audience" }]);
    expect(body.summary).toMatchObject({ created: 1, failed: 0 });
  });

  it("carries opt-outs both ways first, then stops at the deadline and says what's left", async () => {
    s.users = [
      person(1),
      person(2, { notification_settings: { marketingNotifications: false } }),
      person(3),
    ];
    s.contacts = [
      { email: "person1@mail.example.com", unsubscribed: true },
      { email: "person2@mail.example.com", unsubscribed: false },
    ];
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      clock += 300_000;
      return clock;
    });
    const { body } = await sync();
    expect(userUpdates()).toHaveLength(1);
    expect(s.updated).toEqual([{ audienceId: "audience", email: "person2@mail.example.com", unsubscribed: true }]);
    expect(s.removed).toEqual([]);
    expect(s.created).toEqual([]);
    expect(body.summary).toMatchObject({ removalsDeferred: 2, deferred: 1 });
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

  it("stops when sign-ins can't be read, and changes nothing", async () => {
    s.authError = "auth failed";
    s.users = [person(1), person(2, { notification_settings: { marketingNotifications: false } })];
    s.contacts = [{ email: "person2@mail.example.com", unsubscribed: true }];
    expect((await sync()).status).toBe(500);
    expect(s.calls).toEqual([]);
  });

  it("refuses to sync part of an audience bigger than one page", async () => {
    s.hasMore = true;
    s.users = [person(1), person(2, { notification_settings: { marketingNotifications: false } })];
    s.contacts = [{ email: "person2@mail.example.com", unsubscribed: true }];
    expect((await sync()).status).toBe(500);
    expect(s.calls).toEqual([]);
  });
});
