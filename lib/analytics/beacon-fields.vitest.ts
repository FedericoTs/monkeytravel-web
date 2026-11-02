import { describe, it, expect } from "vitest";
import { beaconLocale, beaconPath } from "./beacon-fields";

describe("beaconPath", () => {
  it("keeps the pathname and drops the query string and fragment", () => {
    expect(beaconPath("/es/trips/abc?token=secret&email=a@b.c")).toBe("/es/trips/abc");
    expect(beaconPath("/blog/x#section")).toBe("/blog/x");
  });

  it("cuts a long path at 120 characters, or at the cap given", () => {
    const long = "/" + "a".repeat(300);
    expect(beaconPath(long)).toHaveLength(120);
    expect(beaconPath(long, 200)).toHaveLength(200);
  });

  it("is null for anything that is not a path", () => {
    for (const raw of [undefined, null, 3, "", "trips/abc", "https://monkeytravel.app/trips", "?q=1"]) {
      expect(beaconPath(raw), String(raw)).toBeNull();
    }
  });
});

describe("beaconLocale", () => {
  it("accepts a language, with or without a region", () => {
    expect(beaconLocale("en")).toBe("en");
    expect(beaconLocale("pt-BR")).toBe("pt-BR");
  });

  it("is null for anything else", () => {
    for (const raw of ["EN", "en_GB", "en-gb", "eng", "", undefined, 3]) {
      expect(beaconLocale(raw), String(raw)).toBeNull();
    }
  });
});
