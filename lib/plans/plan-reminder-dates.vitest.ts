import { describe, expect, it } from "vitest";
import {
  PLAN_REMINDER_DAY,
  PLAN_REMINDER_WEEK,
  daysFrom,
  dueReminder,
  planKeptUntil,
  reminderIsOver,
  reminderKind,
  utcToday,
} from "./plan-reminder-dates";

/**
 * When a kept plan's reminders go: a week before (5-7 days out, asked for 8+ days out) and the day before (asked for
 * 2+ days out), each once; the address goes from the trip's first day; the plan's link stays two weeks after the trip.
 */

const TODAY = "2026-12-01";

describe("daysFrom", () => {
  it("counts calendar days, across months and years", () => {
    expect(daysFrom(TODAY, "2026-12-01")).toBe(0);
    expect(daysFrom(TODAY, "2026-12-08")).toBe(7);
    expect(daysFrom(TODAY, "2027-01-01")).toBe(31);
    expect(daysFrom(TODAY, "2026-11-30")).toBe(-1);
  });

  it("is null for what isn't a real day", () => {
    for (const bad of [null, undefined, 20261208, "", "2026-12-8", "2026-02-31", "2026-13-01", "soon", "2026-12-08T10:00"]) {
      expect(daysFrom(TODAY, bad)).toBeNull();
    }
    expect(daysFrom("2026-02-30", "2026-12-08")).toBeNull();
  });
});

describe("utcToday", () => {
  it("is the UTC calendar day", () => {
    expect(utcToday(new Date("2026-12-01T23:30:00-05:00"))).toBe("2026-12-02");
    expect(utcToday(new Date("2026-12-01T00:10:00Z"))).toBe("2026-12-01");
  });
});

describe("reminderKind", () => {
  it("offers the week's email and the day before's from 8 days out", () => {
    expect(reminderKind("2026-12-09", TODAY)).toBe("week");
    expect(reminderKind("2027-05-10", TODAY)).toBe("week");
  });

  it("offers only the day before's from 2 to 7 days out", () => {
    expect(reminderKind("2026-12-08", TODAY)).toBe("day");
    expect(reminderKind("2026-12-03", TODAY)).toBe("day");
  });

  it("offers nothing tomorrow, today, in the past, or for dates nobody chose", () => {
    expect(reminderKind("2026-12-02", TODAY)).toBeNull();
    expect(reminderKind(TODAY, TODAY)).toBeNull();
    expect(reminderKind("2026-11-20", TODAY)).toBeNull();
    expect(reminderKind("2026-12-20", TODAY, true)).toBeNull();
    expect(reminderKind("", TODAY)).toBeNull();
  });
});

describe("dueReminder", () => {
  const START = "2026-12-20";

  it("sends the week's email 7 days out, and still 5 days out after missed runs, but not 4 or 8", () => {
    expect(dueReminder(START, "2026-12-01", "2026-12-13", [])).toBe(PLAN_REMINDER_WEEK);
    expect(dueReminder(START, "2026-12-01", "2026-12-15", [])).toBe(PLAN_REMINDER_WEEK);
    expect(dueReminder(START, "2026-12-01", "2026-12-16", [])).toBeNull();
    expect(dueReminder(START, "2026-12-01", "2026-12-12", [])).toBeNull();
  });

  it("sends the week's email only when asked for 8 days out or more", () => {
    expect(dueReminder(START, "2026-12-12", "2026-12-13", [])).toBe(PLAN_REMINDER_WEEK);
    expect(dueReminder(START, "2026-12-13", "2026-12-14", [])).toBeNull();
  });

  it("sends the day before's email the day before, asked for 2 days out or more", () => {
    expect(dueReminder(START, "2026-12-01", "2026-12-19", [])).toBe(PLAN_REMINDER_DAY);
    expect(dueReminder(START, "2026-12-18", "2026-12-19", [])).toBe(PLAN_REMINDER_DAY);
    expect(dueReminder(START, "2026-12-19", "2026-12-19", [])).toBeNull();
    expect(dueReminder(START, "2026-12-01", "2026-12-18", [])).toBeNull();
    expect(dueReminder(START, "2026-12-01", START, [])).toBeNull();
  });

  it("sends each once", () => {
    expect(dueReminder(START, "2026-12-01", "2026-12-13", [PLAN_REMINDER_WEEK])).toBeNull();
    expect(dueReminder(START, "2026-12-01", "2026-12-19", [PLAN_REMINDER_DAY])).toBeNull();
    expect(dueReminder(START, "2026-12-01", "2026-12-19", [PLAN_REMINDER_WEEK])).toBe(PLAN_REMINDER_DAY);
  });

  it("sends nothing for a trip with no real start", () => {
    expect(dueReminder("2026-02-31", "2026-02-01", "2026-02-28", [])).toBeNull();
    expect(dueReminder(null, "2026-12-01", "2026-12-19", [])).toBeNull();
  });
});

describe("reminderIsOver", () => {
  it("keeps the address up to the day before the trip, and lets it go from its first day", () => {
    expect(reminderIsOver("2026-12-20", "2026-12-19")).toBe(false);
    expect(reminderIsOver("2026-12-20", "2026-12-20")).toBe(true);
    expect(reminderIsOver("2026-12-20", "2027-01-05")).toBe(true);
  });

  it("lets it go when the plan has no real start", () => {
    expect(reminderIsOver(undefined, TODAY)).toBe(true);
    expect(reminderIsOver("2026-13-01", TODAY)).toBe(true);
  });
});

describe("planKeptUntil", () => {
  it("is two weeks after the trip's last day, through that day", () => {
    expect(planKeptUntil("2026-12-20", "2026-12-23")).toBe("2027-01-07T00:00:00.000Z");
  });

  it("counts from the start when the end isn't a real day", () => {
    expect(planKeptUntil("2026-12-20", "")).toBe("2027-01-04T00:00:00.000Z");
    expect(planKeptUntil("2026-12-20", "2026-12-32")).toBe("2027-01-04T00:00:00.000Z");
  });

  it("is null with no real day at all", () => {
    expect(planKeptUntil(null, undefined)).toBeNull();
  });
});
