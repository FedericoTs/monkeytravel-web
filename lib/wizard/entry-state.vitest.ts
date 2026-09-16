import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveEntryState,
  isFirstRunAuthEvent,
  pickMastheadVariant,
} from "./entry-state";

describe("first-run detection keys on the callback's vocabulary", () => {
  it("signup_email and signup_google are a first run", () => {
    expect(isFirstRunAuthEvent("signup_email")).toBe(true);
    expect(isFirstRunAuthEvent("signup_google")).toBe(true);
  });

  it("returning logins are NOT a first run", () => {
    // email_confirmed is what a returning magic-link login carries; before
    // 2026-09-02 the callback stamped first confirmations with it too.
    expect(isFirstRunAuthEvent("email_confirmed")).toBe(false);
    expect(isFirstRunAuthEvent("login_google")).toBe(false);
    expect(isFirstRunAuthEvent(null)).toBe(false);
    expect(isFirstRunAuthEvent("")).toBe(false);
  });
});

describe("masthead variant", () => {
  it("cold by default", () => {
    expect(pickMastheadVariant({ authEventAtMount: null, prefillAtMount: false })).toBe("cold");
    expect(pickMastheadVariant({ authEventAtMount: "login_google", prefillAtMount: false })).toBe("cold");
  });

  it("prefill when an article carried a destination in", () => {
    expect(pickMastheadVariant({ authEventAtMount: null, prefillAtMount: true })).toBe("prefill");
  });

  it("first run wins over prefill", () => {
    expect(pickMastheadVariant({ authEventAtMount: "signup_email", prefillAtMount: true })).toBe("firstRun");
  });
});

describe("entry state (PostHog super-property)", () => {
  const base = { authEventAtMount: null, prefillAtMount: false, claimedTripId: null, isAuthenticated: false as boolean | null };
  it("orders fresh_signup > blog_prefill > claimed > authed > cold_anon", () => {
    expect(deriveEntryState({ ...base, authEventAtMount: "signup_google", prefillAtMount: true, claimedTripId: "t" })).toBe("fresh_signup");
    expect(deriveEntryState({ ...base, prefillAtMount: true, claimedTripId: "t" })).toBe("blog_prefill");
    expect(deriveEntryState({ ...base, claimedTripId: "t", isAuthenticated: true })).toBe("claimed");
    expect(deriveEntryState({ ...base, isAuthenticated: true })).toBe("authed");
    expect(deriveEntryState({ ...base, isAuthenticated: null })).toBe("cold_anon");
    expect(deriveEntryState(base)).toBe("cold_anon");
  });
});

describe("the masthead copy fits the mobile fold", () => {
  // 375px budget from the spec: the destination input must stay in the first
  // viewport on 667px phones, which holds only while the deck is <= 22 words
  // (three lines at text-base). A longer deck is a fold regression, not a
  // copy nit.
  const en = JSON.parse(readFileSync(join(process.cwd(), "messages/en/trips.json"), "utf8"));
  const step1 = en.wizard.step1;
  const words = (s: string) => s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  it("cold deck <= 22 words", () => {
    expect(words(step1.editorial.deck)).toBeLessThanOrEqual(22);
  });
  it("first-run deck <= 24 words", () => {
    expect(words(step1.firstRun.deck)).toBeLessThanOrEqual(24);
  });
  it("headlines stay two lines in Fraunces at 375px (< 40 chars)", () => {
    expect(step1.editorial.title.length).toBeLessThan(40);
    expect(step1.firstRun.title.length).toBeLessThan(40);
  });
  it("copy is honest: approximate time, unconditional free, the 'to see it' qualifier", () => {
    expect(step1.editorial.deck).toMatch(/about 30 seconds/i);
    expect(step1.editorial.deck).toMatch(/free/i);
    expect(step1.editorial.deck).toMatch(/no account needed to see it/i);
  });
});
