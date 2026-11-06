/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import { signFeedbackToken } from "@/lib/feedback/token";

/**
 * The one public way into user_feedback: who is answering comes from a signed
 * link or the session, the limit comes before the write, and only real answers
 * are kept. "Did you go?" needs a link that names a trip.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";
let sessionUser: { id: string } | null;
let allowed: boolean;
let insertFails: boolean;
let log: FakeQuery[] = [];
const limitedAs: unknown[] = [];

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedUser: async () => ({ user: sessionUser }) }));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({
    check: async (_request: unknown, id: unknown) => {
      limitedAs.push(id);
      return { allowed };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase(() => (insertFails ? { data: null, error: { message: "timeout" } } : { data: null, error: null }));
    log = fake.log;
    return fake.client;
  },
}));

const { POST } = await import("./route");

const post = async (body: unknown) => {
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/feedback", { method: "POST", body: JSON.stringify(body) }),
  );
  return { status: res.status, json: await res.json() };
};
const inserted = () => log.find((q) => q.op === "insert")?.value as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.stubEnv("FEEDBACK_LINK_SECRET", randomBytes(32).toString("hex"));
  sessionUser = null;
  allowed = true;
  insertFails = false;
  log = [];
  limitedAs.length = 0;
});

describe("the survey", () => {
  it("keeps a signed link's answers against that user, as an email link", async () => {
    const { json } = await post({
      token: signFeedbackToken(USER),
      source: "in_app",
      uses_for: " day plans ",
      would_book_through_us: "maybe",
      found_via: "search",
      pretrip_content: "yes",
      mobile_app: "no",
      open_to_chat: true,
      contact_email: "ana@example.com",
    });
    expect(json).toEqual({ saved: true });
    expect(inserted()).toMatchObject({
      user_id: USER,
      source: "email_link",
      uses_for: "day plans",
      would_book_through_us: "maybe",
      open_to_chat: true,
      contact_email: "ana@example.com",
      extra: { found_via: "search", pretrip_content: "yes", mobile_app: "no" },
    });
    expect(limitedAs).toEqual([USER]);
  });

  it("uses the session when there's no link", async () => {
    sessionUser = { id: USER };
    await post({ uses_for: "day plans", source: "in_app" });
    expect(inserted()).toMatchObject({ user_id: USER, source: "in_app" });
  });

  it("refuses a link that doesn't verify rather than keeping the answer anonymously", async () => {
    const { status } = await post({ token: `${signFeedbackToken(USER)}x`, uses_for: "day plans" });
    expect(status).toBe(400);
    expect(inserted()).toBeUndefined();
  });

  it("keeps nothing when nothing was answered", async () => {
    const { json } = await post({ token: signFeedbackToken(USER), would_book_through_us: "perhaps", found_via: "tv" });
    expect(json).toEqual({ saved: false });
    expect(inserted()).toBeUndefined();
  });

  it("stops at the limit, before the write", async () => {
    allowed = false;
    const { status } = await post({ token: signFeedbackToken(USER), uses_for: "day plans" });
    expect(status).toBe(429);
    expect(inserted()).toBeUndefined();
  });

  it("says so when the write fails", async () => {
    insertFails = true;
    const { status, json } = await post({ token: signFeedbackToken(USER), uses_for: "day plans" });
    expect(status).toBe(500);
    expect(json.saved).toBeUndefined();
  });
});

describe("did you go?", () => {
  const link = () => signFeedbackToken(USER, 30, TRIP);

  it("keeps the answer against the trip the link names", async () => {
    const { json } = await post({ token: link(), went: "yes" });
    expect(json).toEqual({ saved: true });
    expect(inserted()).toMatchObject({ user_id: USER, source: "email_link", extra: { trip_id: TRIP, went: "yes" } });
  });

  it("ignores a trip sent in the body", async () => {
    await post({ token: link(), went: "no", trip_id: "33333333-3333-4333-8333-333333333333" });
    expect((inserted()?.extra as Record<string, string>).trip_id).toBe(TRIP);
  });

  it("keeps the reason and a trimmed, bounded note", async () => {
    await post({ token: link(), went: "yes", went_reason: "closed", went_note: `  ${"x".repeat(600)} ` });
    const extra = inserted()?.extra as Record<string, string>;
    expect(extra.went_reason).toBe("closed");
    expect(extra.went_note).toBe("x".repeat(500));
  });

  it("drops a reason that doesn't belong to the answer, and an empty note", async () => {
    await post({ token: link(), went: "no", went_reason: "closed", went_note: "   " });
    expect(inserted()?.extra).toEqual({ trip_id: TRIP, went: "no" });
  });

  it("keeps nothing for an answer that isn't one", async () => {
    const { json } = await post({ token: link(), went: "perhaps", went_reason: "closed" });
    expect(json).toEqual({ saved: false });
    expect(inserted()).toBeUndefined();
  });

  it.each([
    ["a link that names no trip", () => signFeedbackToken(USER)],
    ["no link at all", () => undefined],
  ])("needs a trip: %s keeps nothing", async (_name, token) => {
    sessionUser = { id: USER };
    const { json } = await post({ token: token(), went: "yes", went_reason: "closed", went_note: "x" });
    expect(json).toEqual({ saved: false });
    expect(inserted()).toBeUndefined();
  });
});
