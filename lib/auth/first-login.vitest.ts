/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { FIRST_LOGIN_MAX_AGE_MS, isFirstLogin, resolveAuthLanding } from "./first-login";

const NOW = new Date("2026-09-02T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("isFirstLogin", () => {
  it("is true for an account created moments ago that has never been counted in", () => {
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: ago(2000), now: NOW })).toBe(true);
    // handle_new_user creates the row; a missing profile is the same case.
    expect(isFirstLogin({ loginCount: undefined, accountCreatedAt: ago(2000), now: NOW })).toBe(true);
    expect(isFirstLogin({ loginCount: null, accountCreatedAt: ago(2000), now: NOW })).toBe(true);
  });

  it("is false once the account has been counted in, however new", () => {
    expect(isFirstLogin({ loginCount: 1, accountCreatedAt: ago(1000), now: NOW })).toBe(false);
    expect(isFirstLogin({ loginCount: 42, accountCreatedAt: ago(1000), now: NOW })).toBe(false);
  });

  it("is false for an old account still sitting at 0 — the counter postdates it", () => {
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: ago(30 * DAY), now: NOW })).toBe(false);
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: ago(FIRST_LOGIN_MAX_AGE_MS + MINUTE), now: NOW })).toBe(false);
  });

  it("holds the boundary at exactly seven days", () => {
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: ago(FIRST_LOGIN_MAX_AGE_MS - MINUTE), now: NOW })).toBe(true);
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: ago(FIRST_LOGIN_MAX_AGE_MS), now: NOW })).toBe(false);
  });

  it("treats a missing or unparseable creation date as returning, never as a signup", () => {
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: null, now: NOW })).toBe(false);
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: "", now: NOW })).toBe(false);
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: "not a date", now: NOW })).toBe(false);
  });

  it("accepts a Date as well as an ISO string, and survives slight clock skew", () => {
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: new Date(NOW - 1000), now: NOW })).toBe(true);
    expect(isFirstLogin({ loginCount: 0, accountCreatedAt: new Date(NOW + 5000), now: NOW })).toBe(true);
  });
});

describe("resolveAuthLanding", () => {
  it("sends a first arrival bound for the empty trip list to the wizard instead", () => {
    expect(resolveAuthLanding("/trips", true)).toBe("/trips/new");
    expect(resolveAuthLanding("/trips/", true)).toBe("/trips/new");
  });

  it("leaves a returning user on the trip list — that is their home", () => {
    expect(resolveAuthLanding("/trips", false)).toBe("/trips");
  });

  it("never overrides a deliberate destination, even for a first arrival", () => {
    for (const next of ["/trips/abc-123", "/shared/tok", "/explore", "/profile", "/trips/new"]) {
      expect(resolveAuthLanding(next, true)).toBe(next);
    }
  });

  it("matches the trip list even with a query or hash, and preserves it when it is not the trip list", () => {
    expect(resolveAuthLanding("/trips?from=email", true)).toBe("/trips/new");
    expect(resolveAuthLanding("/trips#top", true)).toBe("/trips/new");
    expect(resolveAuthLanding("/trips/xyz?tab=map", true)).toBe("/trips/xyz?tab=map");
  });
});
