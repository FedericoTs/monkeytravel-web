import { describe, it, expect } from "vitest";
import { sortFeed, describeFeedEvent, relativeTime, feedIcon, type FeedEvent } from "./shared";

const ev = (over: Partial<FeedEvent>): FeedEvent => ({
  id: "1",
  kind: "join",
  at: "2026-09-06T10:00:00.000Z",
  actorName: null,
  actorIsOwner: false,
  activityName: null,
  ...over,
});

describe("sortFeed", () => {
  it("orders newest first", () => {
    const out = sortFeed([
      ev({ id: "a", at: "2026-09-06T10:00:00.000Z" }),
      ev({ id: "b", at: "2026-09-06T12:00:00.000Z" }),
      ev({ id: "c", at: "2026-09-06T11:00:00.000Z" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties on id deterministically and does not mutate input", () => {
    const input = [ev({ id: "a" }), ev({ id: "b" })];
    const out = sortFeed(input);
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
    expect(input.map((e) => e.id)).toEqual(["a", "b"]); // untouched
  });
});

describe("describeFeedEvent", () => {
  it("names the actor when present", () => {
    const d = describeFeedEvent(ev({ kind: "join", actorName: " Ana " }));
    expect(d.who).toEqual({ kind: "name", name: "Ana" });
    expect(d.key).toBe("join");
  });

  it("falls back to owner then someone", () => {
    expect(describeFeedEvent(ev({ actorName: null, actorIsOwner: true })).who).toEqual({ kind: "owner" });
    expect(describeFeedEvent(ev({ actorName: "  ", actorIsOwner: false })).who).toEqual({ kind: "someone" });
  });

  it("running late carries minutes, defaulting to 30", () => {
    expect(describeFeedEvent(ev({ kind: "running_late", minutes: 45 })).params.minutes).toBe(45);
    expect(describeFeedEvent(ev({ kind: "running_late" })).params.minutes).toBe(30);
  });

  it("swap uses swapNoName without a target", () => {
    expect(describeFeedEvent(ev({ kind: "swap", activityName: "Lunch", swapTo: "Tapas" })).key).toBe("swap");
    expect(describeFeedEvent(ev({ kind: "swap", activityName: "Lunch", swapTo: null })).key).toBe("swapNoName");
  });

  it("done distinguishes an activity from a whole day", () => {
    expect(describeFeedEvent(ev({ kind: "done", activityName: "Lunch" })).key).toBe("doneActivity");
    expect(describeFeedEvent(ev({ kind: "done", activityName: null })).key).toBe("doneDay");
  });

  it("expense keeps the amount for the view and switches key on activity", () => {
    const withAct = describeFeedEvent(ev({ kind: "expense", amountCents: 1250, currency: "EUR", activityName: "Lunch" }));
    expect(withAct.key).toBe("expenseActivity");
    expect(withAct.amountCents).toBe(1250);
    expect(withAct.currency).toBe("EUR");
    expect(describeFeedEvent(ev({ kind: "expense", amountCents: 500 })).key).toBe("expense");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  it("is 'now' under a minute", () => {
    expect(relativeTime("2026-09-06T11:59:30.000Z", now)).toEqual({ value: 0, unit: "now" });
  });
  it("counts minutes, hours, days", () => {
    expect(relativeTime("2026-09-06T11:30:00.000Z", now)).toEqual({ value: 30, unit: "minute" });
    expect(relativeTime("2026-09-06T09:00:00.000Z", now)).toEqual({ value: 3, unit: "hour" });
    expect(relativeTime("2026-09-04T12:00:00.000Z", now)).toEqual({ value: 2, unit: "day" });
  });
});

describe("feedIcon", () => {
  it("has an icon for every kind", () => {
    for (const k of ["join", "running_late", "skip", "swap", "done", "expense"] as const) {
      expect(feedIcon(k).length).toBeGreaterThan(0);
    }
  });
});
