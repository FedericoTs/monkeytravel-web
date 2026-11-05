import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationStats } from "./activation";
import { topDestinations, usageTotals, type TripRow } from "./breakdowns";
import { activityByUser, cohortRetention } from "./retention";
import { userTrend } from "./user-trend";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("topDestinations", () => {
  const trip = (title: string, trip_meta: unknown = null): TripRow => ({ id: title, user_id: null, status: "planning", title, trip_meta, created_at: daysAgo(1) });

  it("prefers what the wizard set, and falls back to the title without its last word", () => {
    expect(
      topDestinations([trip("Anything", { destination: " Lisbon " }), trip("Lisbon Trip"), trip("Rome trip"), trip("Viaggio a Napoli")])
    ).toEqual([
      { destination: "Lisbon", count: 2 },
      { destination: "Rome", count: 1 },
      { destination: "Viaggio a Napoli", count: 1 },
    ]);
  });

  it("skips a trip with nothing to go on, and a destination that isn't text", () => {
    expect(topDestinations([trip("  "), trip(" Trip", {}), trip("Paris Trip", { destination: 7 })])).toEqual([{ destination: "Paris", count: 1 }]);
  });

  it("keeps the top ten, most planned first", () => {
    const trips = Array.from({ length: 12 }, (_, i) => Array.from({ length: i + 1 }, () => trip(`Place ${i}`))).flat();
    const top = topDestinations(trips);
    expect(top).toHaveLength(10);
    expect(top[0]).toEqual({ destination: "Place 11", count: 12 });
  });
});

describe("usageTotals", () => {
  it("adds up tokens and cost, reading a cost the database answers as text", () => {
    const row = (input_tokens: number | null, cost_cents: number | string | null) => ({ id: "u", action: "a", model_id: "m", input_tokens, output_tokens: input_tokens, cost_cents });
    expect(usageTotals([row(10, 1), row(null, "2.5"), row(5, null)])).toEqual({ inputTokens: 15, outputTokens: 15, costCents: 3.5 });
  });
});

describe("activityByUser", () => {
  it("collects each person's times across tables, skipping what can't be placed", () => {
    const at = daysAgo(1);
    const activity = activityByUser(
      [{ id: "1", user_id: "a", created_at: at }, { id: "2", user_id: null, created_at: at }],
      [{ id: "3", user_id: "a", created_at: at }, { id: "4", user_id: "b", created_at: "not a date" }]
    );
    expect([...activity.keys()]).toEqual(["a"]);
    expect(activity.get("a")).toHaveLength(2);
  });
});

describe("cohortRetention", () => {
  const signedUp = (id: string, iso: string) => ({ id, created_at: iso });

  it("counts who was active in each week since signing up, not since then on", () => {
    // Signed up on Monday, three weeks before the Monday of this week.
    const users = [signedUp("a", "2026-10-12T10:00:00.000Z"), signedUp("b", "2026-10-13T10:00:00.000Z")];
    const [cohort] = cohortRetention(
      users,
      new Map([["a", [new Date("2026-10-20T10:00:00.000Z").getTime(), new Date("2026-11-03T10:00:00.000Z").getTime()]]])
    );
    expect(cohort).toMatchObject({ cohort: "Oct 12", cohortSize: 2 });
    expect(cohort.retention).toEqual([100, 50, 0, 50]);
  });

  it("keeps the last eight cohorts, oldest first, and never more than eight weeks of each", () => {
    const users = Array.from({ length: 12 }, (_, i) => signedUp(`u${i}`, daysAgo(7 * i + 1)));
    const cohorts = cohortRetention(users, new Map());
    expect(cohorts).toHaveLength(8);
    expect(cohorts[7].retention).toEqual([100]);
    expect(cohorts[6].retention).toEqual([100, 0]);
    expect(cohorts[0].retention.length).toBeLessThanOrEqual(8);
    expect(cohortRetention([signedUp("old", daysAgo(200))], new Map())[0].retention).toHaveLength(8);
  });

  it("is empty with nobody to count", () => {
    expect(cohortRetention([], new Map())).toEqual([]);
  });
});

describe("userTrend", () => {
  const onDays = (...days: number[]) => days.map((d) => ({ created_at: daysAgo(d) }));

  it("runs a total from before the window through to today", () => {
    const { daily } = userTrend(onDays(200, 150, 3, 0.01));
    expect(daily[0].cumulative).toBe(2);
    expect(daily.at(-1)).toEqual({ date: "2026-11-05", count: 1, cumulative: 4 });
    expect(daily).toHaveLength(91);
  });

  it("finds the best day and how many days in a row have signups, up to today", () => {
    const { summary } = userTrend(onDays(10, 10, 10, 1, 1, 0.01));
    expect(summary.bestDay).toEqual({ date: daysAgo(10).slice(0, 10), count: 3 });
    expect(summary.currentStreak).toBe(2);
  });

  it("has no streak if nobody signed up today", () => {
    expect(userTrend(onDays(1, 2)).summary.currentStreak).toBe(0);
  });

  it("compares the window's last week with its first", () => {
    expect(userTrend(onDays(89, 88, 1, 2, 3)).summary.totalGrowth).toBe(50);
    expect(userTrend(onDays(1)).summary.totalGrowth).toBe(100);
    expect(userTrend(onDays(40)).summary.totalGrowth).toBe(0);
  });

  it("averages signups over the window's days", () => {
    expect(userTrend(onDays(...Array.from({ length: 91 }, (_, i) => i))).summary.avgDaily).toBe(1);
  });

  it("is empty with nobody to count", () => {
    expect(userTrend([])).toEqual({ daily: [], summary: { totalGrowth: 0, avgDaily: 0, bestDay: null, currentStreak: 0 } });
  });
});

describe("activationStats", () => {
  const rows = <T,>(data: T[]) => ({ data, error: null });
  const owners = (...ids: Array<string | null>) => rows(ids.map((user_id) => ({ user_id })));
  const users = (...list: Array<[string, number]>) => rows(list.map(([id, days]) => ({ id, created_at: daysAgo(days) })));

  it("tells the story from signup to a second trip", () => {
    expect(activationStats(owners("a", "a", "b", null), users(["a", 20], ["b", 20], ["c", 20], ["d", 20]), 4, 2, 4, 1, new Set())).toEqual({
      signupToFirstTripPct: 50,
      multiTripUsers: 1,
      multiTripPct: 50,
      sharedTripPct: 25,
      atRiskUsers: 2,
    });
  });

  it("doesn't call someone at risk who is new, has a trip, or was active this week", () => {
    const stats = activationStats(owners("owner"), users(["new", 3], ["owner", 20], ["active", 20], ["gone", 20]), 4, 1, 1, 0, new Set(["active"]));
    expect(stats.atRiskUsers).toBe(1);
  });

  it("gives what it still can when a read failed, not a false count", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = { data: null, error: { message: "read failed" } };
    const whenTripsFail = activationStats(failure, users(["a", 20]), 10, 5, 8, 2, new Set());
    expect(whenTripsFail).toEqual({ signupToFirstTripPct: 50, multiTripUsers: 0, multiTripPct: 0, sharedTripPct: 25, atRiskUsers: 0 });
    expect(activationStats(owners("a", "a"), failure, 10, 5, 8, 2, new Set())).toEqual(whenTripsFail);
  });

  it("has nothing to divide with nobody yet", () => {
    expect(activationStats(owners(), users(), 0, 0, 0, 0, new Set())).toEqual({ signupToFirstTripPct: 0, multiTripUsers: 0, multiTripPct: 0, sharedTripPct: 0, atRiskUsers: 0 });
  });
});
