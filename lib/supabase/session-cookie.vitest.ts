import { afterEach, describe, expect, it, vi } from "vitest";
import { hasSessionCookie, isSessionCookieName } from "./session-cookie";

/**
 * Whether a browser holds a session decides what it's shown before anything
 * asks the server. Starting a sign-in leaves a verifier cookie named after the
 * session cookie, and it stays when the sign-in isn't finished. That isn't a
 * session.
 */

const VERIFIERS = [
  "sb-ref-auth-token-code-verifier",
  "sb-ref-auth-token-flows-code-verifier",
  "sb-ref-auth-token-flow-abc-code-verifier",
];

describe("isSessionCookieName", () => {
  it("takes the session cookie, whole or in chunks", () => {
    for (const name of ["sb-ref-auth-token", "sb-my-ref-1-auth-token", "sb-ref-auth-token.0", "sb-ref-auth-token.12"]) {
      expect(isSessionCookieName(name), name).toBe(true);
    }
  });

  it("doesn't take a sign-in that was only started, or anything else", () => {
    for (const name of [...VERIFIERS, "sb-auth-token", "xsb-ref-auth-token", "sb-ref-auth-token.x", "mt_session_id"]) {
      expect(isSessionCookieName(name), name).toBe(false);
    }
  });
});

describe("hasSessionCookie", () => {
  const withCookies = (value: string) => vi.spyOn(document, "cookie", "get").mockReturnValue(value);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds it among the page's cookies", () => {
    withCookies("sb-ref-auth-token=x");
    expect(hasSessionCookie()).toBe(true);
    withCookies("mt_session_id=s1; sb-ref-auth-token.0=x; other=y");
    expect(hasSessionCookie()).toBe(true);
  });

  it("doesn't count a verifier, a similar value or no cookies", () => {
    withCookies(VERIFIERS.map((name) => `${name}=x`).join("; "));
    expect(hasSessionCookie()).toBe(false);
    withCookies("other=sb-ref-auth-token");
    expect(hasSessionCookie()).toBe(false);
    withCookies("");
    expect(hasSessionCookie()).toBe(false);
  });
});
