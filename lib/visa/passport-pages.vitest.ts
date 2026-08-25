import { describe, it, expect } from "vitest";
import {
  PASSPORT_PAGE_CODES,
  GROUP_ORDER,
  getPassportSummary,
  passportSlug,
  passportCodeForSlug,
  allPassportSlugs,
} from "./passport-pages";

/**
 * Runs against the real matrix.json, because the property that matters is
 * "does this page tell a traveller the truth about their passport" — which a
 * fixture cannot be wrong about.
 */

describe("the passport shortlist", () => {
  it("is a deliberate shortlist, not all 199", () => {
    // 199 x 4 locales is the shape Google's scaled-content-abuse policy
    // targets. If someone grows this list, they should have to change a test.
    expect(PASSPORT_PAGE_CODES.length).toBe(20);
  });

  it("has a unique slug per passport and round-trips", () => {
    const slugs = allPassportSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const code of PASSPORT_PAGE_CODES) {
      expect(passportCodeForSlug(passportSlug(code))).toBe(code);
    }
  });

  it("slugs are URL-safe and locale-independent", () => {
    for (const s of allPassportSlugs()) {
      expect(s).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  });

  it("returns null for an unknown slug rather than throwing", () => {
    expect(passportCodeForSlug("atlantis")).toBeNull();
  });
});

describe("getPassportSummary", () => {
  it("builds a summary for every passport on the list", () => {
    for (const code of PASSPORT_PAGE_CODES) {
      const s = getPassportSummary(code, "en");
      expect(s, `no summary for ${code}`).not.toBeNull();
      expect(s!.total).toBeGreaterThan(150);
    }
  });

  it("excludes the passport's own country from its destinations", () => {
    const us = getPassportSummary("US", "en")!;
    expect(us.statusByIso2["US"]).toBeUndefined();
    for (const g of us.groups) {
      expect(g.destinations.find((d) => d.iso2 === "US")).toBeUndefined();
    }
  });

  it("never surfaces the synthetic 'same country' status", () => {
    for (const code of PASSPORT_PAGE_CODES) {
      const s = getPassportSummary(code, "en")!;
      expect(s.groups.map((g) => g.status)).not.toContain("same country");
      expect(Object.values(s.statusByIso2)).not.toContain("same country");
    }
  });

  it("counts reconcile with the grouped lists and with the total", () => {
    for (const code of PASSPORT_PAGE_CODES) {
      const s = getPassportSummary(code, "en")!;
      const summed = Object.values(s.counts).reduce((a, b) => a + b, 0);
      expect(summed, code).toBe(s.total);
      const listed = s.groups.reduce((a, g) => a + g.destinations.length, 0);
      expect(listed, code).toBe(s.total);
    }
  });

  it("headline number is visa-free + visa-on-arrival only", () => {
    // eTA and e-visa both require applying BEFORE you fly, so counting them as
    // "no advance paperwork" would overstate what the passport actually does.
    const us = getPassportSummary("US", "en")!;
    expect(us.noAdvancePaperwork).toBe(
      (us.counts["visa free"] ?? 0) + (us.counts["visa on arrival"] ?? 0),
    );
    expect(us.noAdvancePaperwork).toBeLessThan(us.total);
  });

  it("orders groups from least to most paperwork", () => {
    const s = getPassportSummary("IN", "en")!;
    const seen = s.groups.map((g) => g.status);
    const expected = GROUP_ORDER.filter((x) => seen.includes(x));
    expect(seen).toEqual(expected);
  });

  it("sorts destinations by localized name", () => {
    const s = getPassportSummary("US", "es")!;
    const names = s.groups[0].destinations.map((d) => d.name);
    expect([...names].sort((a, b) => a.localeCompare(b, "es"))).toEqual(names);
  });

  it("localizes destination names", () => {
    const en = getPassportSummary("US", "en")!;
    const es = getPassportSummary("US", "es")!;
    const enJp = en.statusByIso2["JP"];
    expect(enJp).toBeDefined();
    const findName = (s: typeof en, iso: string) =>
      s.groups.flatMap((g) => g.destinations).find((d) => d.iso2 === iso)?.name;
    expect(findName(en, "JP")).toBe("Japan");
    expect(findName(es, "JP")).toBe("Japón");
  });

  it("map payload stays small enough to send to the client", () => {
    // The whole point of resolving server-side: matrix.json is 2.4MB, but one
    // passport's row is a few KB. If this ever balloons, the page is shipping
    // something it should not.
    for (const code of PASSPORT_PAGE_CODES) {
      const s = getPassportSummary(code, "en")!;
      expect(JSON.stringify(s.statusByIso2).length).toBeLessThan(6000);
    }
  });

  it("US headline matches the dataset", () => {
    // Spot-check against a value verified by hand from matrix.json, so a
    // silent upstream reshape is caught rather than absorbed.
    const us = getPassportSummary("US", "en")!;
    expect(us.counts["visa free"]).toBeGreaterThan(80);
    expect(us.total).toBeGreaterThanOrEqual(190);
  });
});
