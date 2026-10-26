import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetKeptPlan,
  keptPlanLink,
  keptPlansSnapshot,
  keptTokenFromHash,
  planFingerprint,
  readKeptPlans,
  rememberKeptPlan,
  type KeptPlanEntry,
} from "./kept-plans-client";
import type { KeptPlan } from "./kept-plan";

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";
const entry = (over: Partial<KeptPlanEntry> = {}): KeptPlanEntry => ({
  token: TOKEN,
  destination: "Lisbon, Portugal",
  startDate: "2027-03-15",
  endDate: "2027-03-17",
  dayCount: 3,
  expiresAt: "2099-01-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => localStorage.clear());

describe("the browser's list of kept plans", () => {
  it("puts the latest first, once per plan", () => {
    rememberKeptPlan(entry({ key: "k1" }));
    rememberKeptPlan(entry({ token: "ZZZZZZZZZZZZZZZZZZZZZZ", destination: "Rome" }));
    rememberKeptPlan(entry({ key: "k1" }));
    expect(readKeptPlans().map((e) => e.destination)).toEqual(["Lisbon, Portugal", "Rome"]);
  });

  it("keeps the key it holds when a plan comes back without one", () => {
    rememberKeptPlan(entry({ key: "k1" }));
    rememberKeptPlan(entry({ expiresAt: "2099-02-01T00:00:00.000Z" }));
    expect(readKeptPlans()[0]).toMatchObject({ key: "k1", expiresAt: "2099-02-01T00:00:00.000Z" });
  });

  it("leaves out expired plans and forgets on request", () => {
    rememberKeptPlan(entry({ expiresAt: "2000-01-01T00:00:00.000Z" }));
    expect(readKeptPlans()).toEqual([]);
    rememberKeptPlan(entry());
    forgetKeptPlan(TOKEN);
    expect(readKeptPlans()).toEqual([]);
  });

  it("hands useSyncExternalStore the same array until the list changes", () => {
    rememberKeptPlan(entry());
    const first = keptPlansSnapshot();
    expect(keptPlansSnapshot()).toBe(first);
    rememberKeptPlan(entry({ token: "ZZZZZZZZZZZZZZZZZZZZZZ" }));
    expect(keptPlansSnapshot()).not.toBe(first);
  });

  it("survives a corrupt store", () => {
    localStorage.setItem("mt_kept_plans", "{not json");
    expect(readKeptPlans()).toEqual([]);
  });
});

describe("the private link", () => {
  it("carries the token in the fragment of the planner's own address", () => {
    const link = keptPlanLink("https://monkeytravel.app/it/trips/new?destination=Roma#x", TOKEN);
    expect(link).toBe(`https://monkeytravel.app/it/trips/new#plan=${TOKEN}`);
    expect(keptTokenFromHash(new URL(link).hash)).toBe(TOKEN);
  });

  it("reads no token from anything else", () => {
    expect(keptTokenFromHash("")).toBeNull();
    expect(keptTokenFromHash("#plan=short")).toBeNull();
    expect(keptTokenFromHash("#other=1")).toBeNull();
  });
});

describe("planFingerprint", () => {
  it("changes with the plan", () => {
    const plan = { destination: "Lisbon", startDate: "2027-03-15", endDate: "2027-03-17" } as KeptPlan;
    expect(planFingerprint(plan)).toBe(planFingerprint({ ...plan }));
    expect(planFingerprint(plan)).not.toBe(planFingerprint({ ...plan, endDate: "2027-03-18" }));
  });
});
