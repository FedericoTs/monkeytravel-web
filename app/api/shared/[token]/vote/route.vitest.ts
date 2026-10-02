/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Signed out, a vote is this browser's, as before. Signed in, it is the
 * account's on any browser: the browser's guest votes are linked first, a
 * revote updates the account's row, and a cookie that already keys another
 * account's vote (a shared device) is not reused.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
let signedIn: { id: string } | null = null;
let browserCookie: string | undefined;
/** The account's vote on the activity, if any. */
let accountVote: { id: string } | null = null;
/** A vote this browser's cookie already keys on the activity, if any. */
let cookieVote: { id: string } | null = null;
let tally: Array<{ vote_type: string; voter_cookie_id: string; user_id: string | null }> = [];
let log: FakeQuery[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browserCookie ? { value: browserCookie } : undefined), set: vi.fn() }),
}));
vi.mock("nanoid", () => ({ nanoid: () => "fresh-browser-id-0001" }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true }) }) }));
vi.mock("@/lib/analytics/funnel-events", () => ({ logFunnelEventServer: async () => undefined }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: async () => undefined }));
vi.mock("@/lib/notifications/service", () => ({ enqueueNotification: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "trips") return { data: { id: "trip-1", user_id: "owner-1", title: "Lisbon" }, error: null };
      if (q.table === "anonymous_activity_votes" && q.end === "maybeSingle") {
        return { data: eqOf(q, "user_id") ? accountVote : cookieVote, error: null };
      }
      if (q.table === "anonymous_activity_votes" && q.op === "select" && q.end === "list") return { data: tally, error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));

const { POST } = await import("./route");
const vote = (body: Record<string, unknown>) =>
  POST(
    new NextRequest(`http://localhost/api/shared/${TOKEN}/vote`, {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0", "content-type": "application/json" },
      body: JSON.stringify({ activity_id: "act-1", ...body }),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );
const votesOp = (op: FakeQuery["op"]) => log.filter((q) => q.table === "anonymous_activity_votes" && q.op === op);

beforeEach(() => {
  signedIn = null;
  browserCookie = "browser-cookie-1";
  accountVote = null;
  cookieVote = null;
  tally = [];
});

describe("POST /api/shared/[token]/vote", () => {
  it("keys a signed-out vote by this browser, as before", async () => {
    const res = await vote({ vote_type: "up" });
    expect(res.status).toBe(200);
    const [upsert] = votesOp("upsert");
    expect(upsert.value).toMatchObject({ voter_cookie_id: "browser-cookie-1", vote_type: "up" });
    expect(upsert.value).not.toHaveProperty("user_id");
    expect(log.filter((q) => q.op === "rpc")).toEqual([]);
  });

  it("signed in, links this browser's guest votes, then adds the account's vote", async () => {
    signedIn = { id: "user-1" };
    tally = [{ vote_type: "up", voter_cookie_id: "browser-cookie-1", user_id: "user-1" }];
    const res = await vote({ vote_type: "up" });
    const [link] = log.filter((q) => q.op === "rpc");
    expect(link.value).toEqual({ p_user_id: "user-1", p_cookie: "browser-cookie-1", p_trip_id: "trip-1" });
    const [insert] = votesOp("insert");
    expect(log.indexOf(link)).toBeLessThan(log.indexOf(insert));
    expect(insert.value).toMatchObject({ user_id: "user-1", voter_cookie_id: "browser-cookie-1", vote_type: "up" });
    expect(votesOp("upsert")).toEqual([]);
    const body = await res.json();
    expect((body.data ?? body).myVote).toBe("up");
  });

  it("signed in, a revote updates the account's vote, from any browser", async () => {
    signedIn = { id: "user-1" };
    browserCookie = "other-browser-02";
    accountVote = { id: "vote-9" };
    await vote({ vote_type: "down" });
    const [update] = votesOp("update");
    expect(eqOf(update, "id")).toBe("vote-9");
    expect(update.value).toEqual({ vote_type: "down" });
    expect(votesOp("insert")).toEqual([]);
  });

  it("signed in, doesn't reuse a cookie that keys another account's vote", async () => {
    signedIn = { id: "user-1" };
    cookieVote = { id: "someone-elses-vote" };
    await vote({ vote_type: "up" });
    expect(votesOp("insert")[0].value).toMatchObject({ user_id: "user-1", voter_cookie_id: "fresh-browser-id-0001" });
  });

  it("signed in, removes the account's vote", async () => {
    signedIn = { id: "user-1" };
    await vote({ vote_type: null });
    const [removal] = votesOp("delete");
    expect(eqOf(removal, "user_id")).toBe("user-1");
    expect(eqOf(removal, "voter_cookie_id")).toBeUndefined();
  });
});
