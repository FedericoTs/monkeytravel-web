// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissKeepBoth,
  firstKeepBothShow,
  forgetSignInFromCard,
  keepBothCardShows,
  keepBothDismissed,
  markSignInFromCard,
  takeSignInFromCard,
} from "./keep-both";

const shows = (over: Partial<Parameters<typeof keepBothCardShows>[0]> = {}) =>
  keepBothCardShows({ signedOut: true, planOnScreen: true, unsaved: true, places: 2, dismissed: false, boxOpen: false, ...over });

describe("the keep-both card", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("shows signed out, on an unsaved plan, with two or more places this visit", () => {
    expect(shows()).toBe(true);
    expect(shows({ places: 3 })).toBe(true);
  });

  it("doesn't show with one place, signed in, saved, without a plan, turned down, or behind the box", () => {
    expect(shows({ places: 1 })).toBe(false);
    expect(shows({ signedOut: false })).toBe(false);
    expect(shows({ unsaved: false })).toBe(false);
    expect(shows({ planOnScreen: false })).toBe(false);
    expect(shows({ dismissed: true })).toBe(false);
    expect(shows({ boxOpen: true })).toBe(false);
  });

  it("is turned down for the tab, and counted once", () => {
    expect(keepBothDismissed()).toBe(false);
    dismissKeepBoth();
    expect(keepBothDismissed()).toBe(true);
    expect(firstKeepBothShow()).toBe(true);
    expect(firstKeepBothShow()).toBe(false);
  });

  it("tells its sign-in apart once, and drops the mark when the box closes without one", () => {
    expect(takeSignInFromCard()).toBe(false);
    markSignInFromCard();
    expect(takeSignInFromCard()).toBe(true);
    expect(takeSignInFromCard()).toBe(false);
    markSignInFromCard();
    forgetSignInFromCard();
    expect(takeSignInFromCard()).toBe(false);
  });
});
