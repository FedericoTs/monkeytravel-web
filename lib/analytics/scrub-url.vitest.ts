import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { scrubCapture, scrubUrl } from "./scrub-url";

const SITE = "https://monkeytravel.app";

describe("scrubUrl", () => {
  it.each([
    [`${SITE}/es/shared/a1B2c3D4e5?ref=wa`, `${SITE}/es/shared/:token?ref=wa`],
    [`${SITE}/shared/a1B2c3D4e5`, `${SITE}/shared/:token`],
    [`${SITE}/it/invite/Zx9_token-01`, `${SITE}/it/invite/:token`],
    [`${SITE}/pt/feedback/fb-token-77`, `${SITE}/pt/feedback/:token`],
    [`${SITE}/join/K7Q2LM`, `${SITE}/join/:code`],
    ["/es/shared/a1B2c3D4e5", "/es/shared/:token"],
  ])("replaces the key in a link's path: %s", (url, scrubbed) => {
    expect(scrubUrl(url)).toBe(scrubbed);
  });

  it.each([
    [`${SITE}/es/day/7f3c/2027-03-25?k=SIGNED&s=SEND`, `${SITE}/es/day/7f3c/2027-03-25`],
    [`${SITE}/unsubscribe?token=abc123&lang=it`, `${SITE}/unsubscribe?lang=it`],
    [`${SITE}/es/auth/callback?code=xyz&next=%2Ftrips`, `${SITE}/es/auth/callback?next=%2Ftrips`],
    [`${SITE}/auth/confirm?token_hash=th&type=email`, `${SITE}/auth/confirm?type=email`],
  ])("drops keys from the query: %s", (url, scrubbed) => {
    expect(scrubUrl(url)).toBe(scrubbed);
  });

  it("drops a fragment that carries parameters, and keeps a plain anchor", () => {
    expect(scrubUrl(`${SITE}/auth/reset-password#access_token=a.b.c&type=recovery`)).toBe(`${SITE}/auth/reset-password`);
    expect(scrubUrl(`${SITE}/blog/where-to-go-at-easter#sources`)).toBe(`${SITE}/blog/where-to-go-at-easter#sources`);
  });

  it.each([
    `${SITE}/trips/new?destination=Rome%2C%20Italy&days=4`,
    `${SITE}/blog/shared-expenses-app`,
    `${SITE}/es/trips/0b1f9c3e-1111-4222-8333-944455556666`,
    `${SITE}/where-should-i-go/beach-lover`,
    `${SITE}/?mt_team=1`,
    "",
  ])("leaves an address with no key exactly as it was: %s", (url) => {
    expect(scrubUrl(url)).toBe(url);
  });
});

describe("scrubCapture (PostHog's before_send)", () => {
  it("scrubs every address on the event and on the person properties, and nothing else", () => {
    const capture = {
      event: "$pageview",
      properties: {
        $current_url: `${SITE}/es/shared/a1B2c3D4e5`,
        $pathname: "/es/shared/a1B2c3D4e5",
        $referrer: `${SITE}/it/invite/Zx9_token-01`,
        $session_entry_url: `${SITE}/es/day/7f3c/2027-03-25?k=SIGNED`,
        page_url: `${SITE}/join/K7Q2LM`,
        trip_id: "trip-1",
        note: "/shared/a1B2c3D4e5",
      },
      $set: { $current_url: `${SITE}/shared/a1B2c3D4e5` },
      $set_once: { $initial_current_url: `${SITE}/shared/a1B2c3D4e5`, $initial_pathname: "/shared/a1B2c3D4e5" },
    };
    expect(scrubCapture(capture)).toEqual({
      event: "$pageview",
      properties: {
        $current_url: `${SITE}/es/shared/:token`,
        $pathname: "/es/shared/:token",
        $referrer: `${SITE}/it/invite/:token`,
        $session_entry_url: `${SITE}/es/day/7f3c/2027-03-25`,
        page_url: `${SITE}/join/:code`,
        trip_id: "trip-1",
        note: "/shared/a1B2c3D4e5",
      },
      $set: { $current_url: `${SITE}/shared/:token` },
      $set_once: { $initial_current_url: `${SITE}/shared/:token`, $initial_pathname: "/shared/:token" },
    });
  });

  it("scrubs the page address a recording notes on each page change", () => {
    const capture = {
      event: "$snapshot",
      properties: {
        $snapshot_data: [{ type: 4, data: { href: `${SITE}/es/shared/a1B2c3D4e5`, width: 390, height: 844 } }],
      },
    };
    const out = scrubCapture(capture)!;
    const entries = out.properties!.$snapshot_data as Array<{ type: number; data: { href: string } }>;
    expect(entries[0].data).toEqual({ href: `${SITE}/es/shared/:token`, width: 390, height: 844 });
  });

  it("passes a dropped event through", () => {
    expect(scrubCapture(null)).toBeNull();
  });

  it("is what PostHog runs before sending", () => {
    const source = readFileSync("instrumentation-client.ts", "utf8");
    expect(source.match(/before_send: scrubCapture,/g)).toHaveLength(1);
  });
});
