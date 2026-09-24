import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_LOCALES,
  buildAuthCallbackUrl,
  callbackIntentFromRedirect,
  localizePath,
  normalizeAuthLocale,
  splitLocalePrefix,
  unprefixedCallbackUrl,
  unwrapCallbackNext,
} from "./callback-url";

/**
 * The return trip from Google or an emailed link.
 *
 * Until 2026-09-24 the save prompt built /pt/auth/callback, a route that does
 * not exist, so every es/it/pt sign-in from it ended on a 404. And the
 * send-email hook nested the callback URL inside `next`, which sent a
 * signed-in user through the callback twice and out to the login page with an
 * error. These pin each piece of the fix.
 */

const APP = "https://monkeytravel.app";

describe("locales", () => {
  it("are the ones the router serves", () => {
    // Read as source: importing lib/i18n/routing pulls in next-intl's client
    // navigation, which does not load under vitest.
    const src = readFileSync(join(process.cwd(), "lib/i18n/routing.ts"), "utf8");
    const listed = src.match(/locales:\s*\[([^\]]*)\]/)?.[1] ?? "";
    const routed = [...listed.matchAll(/"([a-z]{2})"/g)].map((m) => m[1]);
    expect(routed.length).toBeGreaterThan(0);
    expect([...AUTH_LOCALES].sort()).toEqual(routed.sort());
  });

  it("accept region tags and reject anything else", () => {
    expect(normalizeAuthLocale("pt")).toBe("pt");
    expect(normalizeAuthLocale("pt-BR")).toBe("pt");
    expect(normalizeAuthLocale(" IT ")).toBe("it");
    expect(normalizeAuthLocale("de")).toBeUndefined();
    expect(normalizeAuthLocale("/evil.com")).toBeUndefined();
    expect(normalizeAuthLocale(null)).toBeUndefined();
  });

  it("split a prefix off a path without eating a longer segment", () => {
    expect(splitLocalePrefix("/pt/trips/new?x=1")).toEqual({ locale: "pt", rest: "/trips/new?x=1" });
    expect(splitLocalePrefix("/pt")).toEqual({ locale: "pt", rest: "/" });
    expect(splitLocalePrefix("/pt?x=1")).toEqual({ locale: "pt", rest: "/?x=1" });
    expect(splitLocalePrefix("/ptolemy")).toEqual({ locale: null, rest: "/ptolemy" });
    expect(splitLocalePrefix("/trips")).toEqual({ locale: null, rest: "/trips" });
  });
});

describe("buildAuthCallbackUrl", () => {
  it("never puts the locale in the path", () => {
    for (const locale of ["es", "it", "pt"]) {
      const url = new URL(buildAuthCallbackUrl(APP, { next: "/trips/new", locale }));
      expect(url.pathname).toBe("/auth/callback");
      expect(url.searchParams.get("locale")).toBe(locale);
      expect(url.searchParams.get("next")).toBe("/trips/new");
    }
  });

  it("keeps a next that has its own query intact", () => {
    const url = new URL(buildAuthCallbackUrl(APP, { next: "/trips/new?dest=Lisbon&days=3", locale: "pt" }));
    expect(url.searchParams.get("next")).toBe("/trips/new?dest=Lisbon&days=3");
    expect(url.searchParams.get("locale")).toBe("pt");
  });

  it("drops a locale the site does not serve", () => {
    const url = new URL(buildAuthCallbackUrl(APP, { next: "/trips/new", locale: "de" }));
    expect(url.searchParams.has("locale")).toBe(false);
  });
});

describe("localizePath", () => {
  it("prefixes non-English landings", () => {
    expect(localizePath("/trips/new", "pt")).toBe("/pt/trips/new");
    expect(localizePath("/auth/login?error=x", "es")).toBe("/es/auth/login?error=x");
  });

  it("leaves English and unknown locales unprefixed", () => {
    expect(localizePath("/trips/new", "en")).toBe("/trips/new");
    expect(localizePath("/trips/new", "de")).toBe("/trips/new");
    expect(localizePath("/trips/new", undefined)).toBe("/trips/new");
  });

  it("never prefixes twice (the invite page's next is already prefixed)", () => {
    expect(localizePath("/pt/invite/abc", "pt")).toBe("/pt/invite/abc");
    expect(localizePath("/it/trips", "pt")).toBe("/it/trips");
  });
});

describe("unwrapCallbackNext", () => {
  it("passes an ordinary destination through", () => {
    expect(unwrapCallbackNext("/trips/new")).toEqual({ next: "/trips/new", locale: undefined });
    expect(unwrapCallbackNext("/pt/invite/abc")).toEqual({ next: "/pt/invite/abc", locale: "pt" });
  });

  it("unwraps what the hook used to nest: /auth/callback?next=/trips/new", () => {
    expect(unwrapCallbackNext("/auth/callback?next=%2Ftrips%2Fnew")).toEqual({
      next: "/trips/new",
      locale: undefined,
    });
  });

  it("unwraps the 404ing prefixed form and keeps its language", () => {
    expect(unwrapCallbackNext("/pt/auth/callback?next=%2Ftrips%2Fnew")).toEqual({
      next: "/trips/new",
      locale: "pt",
    });
  });

  it("prefers an explicit locale param to the prefix", () => {
    expect(unwrapCallbackNext("/auth/callback?next=%2Ftrips&locale=it")).toEqual({
      next: "/trips",
      locale: "it",
    });
  });

  it("returns null when the callback carried no destination", () => {
    // The signup page's referral link: /auth/callback?locale=pt, no next.
    expect(unwrapCallbackNext("/auth/callback?locale=pt")).toEqual({ next: null, locale: "pt" });
  });

  it("re-checks every hop, so nesting cannot smuggle out an open redirect", () => {
    for (const evil of ["https://evil.com", "//evil.com", "/\\evil.com", "/x://evil.com"]) {
      const nested = `/auth/callback?next=${encodeURIComponent(evil)}`;
      expect(unwrapCallbackNext(nested).next).toBeNull();
    }
  });

  it("stops on a crafted loop instead of spinning", () => {
    let url = "/trips";
    for (let i = 0; i < 10; i++) url = `/auth/callback?next=${encodeURIComponent(url)}`;
    expect(unwrapCallbackNext(url).next).toBeNull();
  });
});

describe("unprefixedCallbackUrl (middleware)", () => {
  it("moves /pt/auth/callback to the real route and keeps the code", () => {
    const target = unprefixedCallbackUrl(new URL(`${APP}/pt/auth/callback?next=%2Ftrips%2Fnew&code=abc123`));
    expect(target).not.toBeNull();
    expect(target!.origin).toBe(APP);
    expect(target!.pathname).toBe("/auth/callback");
    expect(target!.searchParams.get("code")).toBe("abc123");
    expect(target!.searchParams.get("next")).toBe("/trips/new");
    expect(target!.searchParams.get("locale")).toBe("pt");
  });

  it("covers every prefixed locale and a trailing slash", () => {
    for (const l of ["en", "es", "it", "pt"]) {
      expect(unprefixedCallbackUrl(new URL(`${APP}/${l}/auth/callback`))?.pathname).toBe("/auth/callback");
      expect(unprefixedCallbackUrl(new URL(`${APP}/${l}/auth/callback/`))?.pathname).toBe("/auth/callback");
    }
  });

  it("keeps a locale param that was already there", () => {
    const target = unprefixedCallbackUrl(new URL(`${APP}/pt/auth/callback?locale=it&code=x`));
    expect(target!.searchParams.get("locale")).toBe("it");
  });

  it("leaves every other path alone", () => {
    for (const path of ["/auth/callback", "/pt/auth/login", "/pt/auth/callbackx", "/pt/trips", "/"]) {
      expect(unprefixedCallbackUrl(new URL(`${APP}${path}`))).toBeNull();
    }
  });
});

describe("callbackIntentFromRedirect (send-email hook)", () => {
  it("lifts the destination out of the save prompt's callback URL", () => {
    const redirectTo = `${APP}/auth/callback?next=%2Ftrips%2Fnew&locale=pt`;
    expect(callbackIntentFromRedirect(redirectTo, APP)).toEqual({ next: "/trips/new", locale: "pt" });
  });

  it("does the same for links built before the fix (/pt/auth/callback)", () => {
    const redirectTo = `${APP}/pt/auth/callback?next=%2Ftrips%2Fnew`;
    expect(callbackIntentFromRedirect(redirectTo, APP)).toEqual({ next: "/trips/new", locale: "pt" });
  });

  it("keeps the referral and does not invent a destination", () => {
    // app/[locale]/auth/signup/page.tsx emailRedirectTo for a referred signup.
    const redirectTo = `${APP}/auth/callback?ref=ABC123&locale=es`;
    expect(callbackIntentFromRedirect(redirectTo, APP)).toEqual({ ref: "ABC123", locale: "es" });
  });

  it("passes an ordinary page through as next, with its prefix as the locale", () => {
    const redirectTo = `${APP}/pt/invite/tok123`;
    expect(callbackIntentFromRedirect(redirectTo, APP)).toEqual({ next: "/pt/invite/tok123", locale: "pt" });
  });

  it("treats the bare site URL as no intent", () => {
    expect(callbackIntentFromRedirect(APP, APP)).toEqual({});
    expect(callbackIntentFromRedirect(undefined, APP)).toEqual({});
  });

  it("ignores another origin and malformed input", () => {
    expect(callbackIntentFromRedirect("https://evil.com/auth/callback?next=%2Ftrips", APP)).toEqual({});
    expect(callbackIntentFromRedirect("http://[bad", APP)).toEqual({});
  });
});
