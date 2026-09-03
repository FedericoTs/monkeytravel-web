import { describe, it, expect } from "vitest";
import { crewShareUrl, shareTokenFromUrl, totalVotes } from "./crew-share";

const URL_BASE = "https://monkeytravel.app/en/shared/11111111-2222-3333-4444-555555555555";

describe("crewShareUrl", () => {
  it("marks a crew ask", () => {
    expect(crewShareUrl(URL_BASE, "crew")).toBe(`${URL_BASE}?vote=1`);
  });

  it("leaves a plain share alone", () => {
    expect(crewShareUrl(URL_BASE, "share")).toBe(URL_BASE);
  });

  it("keeps the referral code the share API appends", () => {
    // ?ref=CODE is the owner's referral attribution — dropping it would break
    // the signup credit for every crew link.
    expect(crewShareUrl(`${URL_BASE}?ref=ABC123`, "crew")).toBe(`${URL_BASE}?ref=ABC123&vote=1`);
  });

  it("does not stack the marker when a link is already an ask", () => {
    expect(crewShareUrl(`${URL_BASE}?vote=1`, "crew")).toBe(`${URL_BASE}?vote=1`);
    expect(crewShareUrl(`${URL_BASE}?ref=A&vote=1`, "crew")).toBe(`${URL_BASE}?ref=A&vote=1`);
  });

  it("keeps a fragment at the end where it belongs", () => {
    expect(crewShareUrl(`${URL_BASE}#day-2`, "crew")).toBe(`${URL_BASE}?vote=1#day-2`);
  });

  it("has nothing to mark before a link exists", () => {
    expect(crewShareUrl(null, "crew")).toBeNull();
    expect(crewShareUrl(undefined, "crew")).toBeNull();
    expect(crewShareUrl("", "crew")).toBeNull();
  });
});

describe("shareTokenFromUrl", () => {
  const TOKEN = "11111111-2222-3333-4444-555555555555";

  it("reads the token off a plain link", () => {
    expect(shareTokenFromUrl(URL_BASE)).toBe(TOKEN);
  });

  it("ignores the query and the fragment", () => {
    expect(shareTokenFromUrl(`${URL_BASE}?vote=1&ref=X`)).toBe(TOKEN);
    expect(shareTokenFromUrl(`${URL_BASE}?vote=1#day-2`)).toBe(TOKEN);
  });

  it("survives a trailing slash", () => {
    expect(shareTokenFromUrl(`${URL_BASE}/`)).toBe(TOKEN);
  });

  it("returns null rather than guessing", () => {
    expect(shareTokenFromUrl(null)).toBeNull();
    expect(shareTokenFromUrl("")).toBeNull();
    expect(shareTokenFromUrl("https://monkeytravel.app/")).toBeNull();
  });
});

describe("totalVotes", () => {
  it("counts up and down together — a thumbs-down is still an answer", () => {
    expect(totalVotes({ a: { up: 2, down: 1 }, b: { up: 0, down: 3 } })).toBe(6);
  });

  it("is zero when nobody has answered", () => {
    expect(totalVotes({})).toBe(0);
    expect(totalVotes(null)).toBe(0);
    expect(totalVotes(undefined)).toBe(0);
  });

  it("never throws on a malformed payload", () => {
    // This number decorates a share box; a bad response must degrade to
    // "no votes yet", never to a broken share control.
    const junk = { a: null, b: undefined, c: "nope", d: { up: NaN, down: 2 }, e: { up: 1 } } as never;
    expect(totalVotes(junk)).toBe(3);
  });
});

describe("shareTokenFromUrl — the hostname trap", () => {
  it("refuses a URL that has no token in it", () => {
    // The last path segment of "https://monkeytravel.app/" is the HOSTNAME.
    // Without the UUID check this shipped a fetch for /api/shared/
    // monkeytravel.app/votes on every render of a link-less share box.
    expect(shareTokenFromUrl("https://monkeytravel.app/")).toBeNull();
    expect(shareTokenFromUrl("https://monkeytravel.app/en/shared")).toBeNull();
    expect(shareTokenFromUrl("https://monkeytravel.app/en/shared/not-a-uuid")).toBeNull();
  });
});
