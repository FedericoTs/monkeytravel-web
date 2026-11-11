import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * What GA4 hears from a visit. GA4 counts sessions itself, so SessionTracker
 * sends no session_start of its own, and user_return is a signed-in person
 * back after more than 30 minutes with no page of the site in view.
 */

const visitor = vi.hoisted(() => ({ signedIn: true }));
const posthog = vi.hoisted(() => ({ identifyUser: vi.fn(), forgetSignedOutPerson: vi.fn() }));

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/posthog", () => posthog);
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSessionCookie: () => visitor.signedIn }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    ...fakeSupabase(answer).client,
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "ana@example.com", user_metadata: {} } } }) },
  }),
}));

function answer(q: FakeQuery) {
  if (q.table === "users") {
    return {
      data: { created_at: "2026-01-01T00:00:00Z", onboarding_completed: true, subscription_tier: "free", referral_tier: 0, preferred_language: "en" },
      error: null,
    };
  }
  if (q.table === "trips") return { data: null, count: 2, error: null };
  return { data: null, error: null };
}

const { default: SessionTracker } = await import("./SessionTracker");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const gtag = vi.fn();
let shown: DocumentVisibilityState = "visible";
let signedInVisits = 0;

const sent = (name: string) =>
  gtag.mock.calls.filter(([command, event]) => command === "event" && event === name).map(([, , params]) => params);
const userProperties = () =>
  gtag.mock.calls.filter(([command, target]) => command === "set" && target === "user_properties").map(([, , params]) => params);
const lastSeen = (ago: number) => localStorage.setItem("mt_last_visit", String(Date.now() - ago));

/** A page load: SessionTracker mounts and finishes its reads. */
async function open() {
  render(<SessionTracker />);
  if (!visitor.signedIn) return act(async () => {});
  signedInVisits += 1;
  await vi.waitFor(() => expect(posthog.identifyUser).toHaveBeenCalledTimes(signedInVisits));
}

function show(state: DocumentVisibilityState) {
  shown = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  localStorage.clear();
  visitor.signedIn = true;
  signedInVisits = 0;
  shown = "visible";
  posthog.identifyUser.mockClear();
  gtag.mockClear();
  window.gtag = gtag;
  window.requestIdleCallback = ((callback: IdleRequestCallback) => {
    callback({} as IdleDeadline);
    return 1;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = () => {};
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => shown });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe("session_start", () => {
  it("is left to GA4, which counts sessions itself", async () => {
    visitor.signedIn = false;
    await open();
    cleanup();
    visitor.signedIn = true;
    lastSeen(2 * DAY);
    await open();
    expect(sent("session_start")).toEqual([]);
  });
});

describe("user_return", () => {
  it("is a signed-in person back after more than 30 minutes away", async () => {
    lastSeen(31 * MINUTE);
    await open();
    expect(sent("user_return")).toEqual([{ signed_in: true, days_since_last_visit: 0, return_bucket: "same_day" }]);
  });

  it("counts the time away in whole days", async () => {
    lastSeen(3 * DAY + 20 * 60 * MINUTE);
    await open();
    expect(sent("user_return")).toEqual([{ signed_in: true, days_since_last_visit: 3, return_bucket: "d2_7" }]);
  });

  it("is not a page opened 30 minutes or less after the last one", async () => {
    localStorage.setItem("mt_session_count", "7");
    lastSeen(30 * MINUTE);
    await open();
    expect(sent("user_return")).toEqual([]);
  });

  it("is not a first visit on this device", async () => {
    await open();
    expect(sent("user_return")).toEqual([]);
  });

  it("is not an anonymous visitor", async () => {
    visitor.signedIn = false;
    lastSeen(2 * DAY);
    await open();
    expect(sent("user_return")).toEqual([]);
  });

  it("is not a new page opened while another one stayed in view", async () => {
    await open();
    await wait(60 * MINUTE);
    await open();
    expect(sent("user_return")).toEqual([]);
  });

  it("is coming back to a page left in the background for more than 30 minutes", async () => {
    await open();
    show("hidden");
    await wait(45 * MINUTE);
    show("visible");
    expect(sent("user_return")).toEqual([{ signed_in: true, days_since_last_visit: 0, return_bucket: "same_day" }]);
  });

  it("is not coming back to it within 30 minutes", async () => {
    await open();
    show("hidden");
    await wait(20 * MINUTE);
    show("visible");
    expect(sent("user_return")).toEqual([]);
  });

  it("is not an anonymous visitor coming back to a page", async () => {
    visitor.signedIn = false;
    await open();
    show("hidden");
    await wait(45 * MINUTE);
    show("visible");
    expect(sent("user_return")).toEqual([]);
  });

  it("is never guessed when storage is blocked, and the visit is still tracked", async () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    await open();
    show("hidden");
    await wait(45 * MINUTE);
    show("visible");
    expect(sent("user_return")).toEqual([]);
  });
});

describe("the person's GA4 properties", () => {
  it("carry no made-up referral source", async () => {
    await open();
    expect(userProperties().at(-1)).toMatchObject({ trips_count: 2, user_stage: "engaged" });
    expect(userProperties().at(-1)).not.toHaveProperty("referral_source");
  });
});
