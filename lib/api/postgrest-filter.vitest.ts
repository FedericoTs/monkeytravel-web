import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { destinationCityTerm, ilikeOrTerm } from "./postgrest-filter";

/**
 * Text going into a PostgREST or() filter.
 *
 * "Chennai, India" put a comma inside or(), PostgREST read it as a second
 * condition and answered 400, and the AI assistant got no coordinates for the
 * trip (seen twice on 2026-09-24).
 */

describe("destinationCityTerm", () => {
  it("keeps only the city of a City, Country destination", () => {
    expect(destinationCityTerm("Chennai, India")).toBe("Chennai");
    expect(destinationCityTerm("Paris, France")).toBe("Paris");
    expect(destinationCityTerm("Lisbon")).toBe("Lisbon");
  });

  it("never leaves an or() delimiter in the value", () => {
    for (const raw of ["Paris (Île-de-France), France", 'Quote "x"', "a,b,c", "(", "St. John's (NL)"]) {
      expect(destinationCityTerm(raw)).not.toMatch(/[,()"]/);
    }
  });

  it("returns empty for a destination with no city part", () => {
    expect(destinationCityTerm(", India")).toBe("");
    expect(destinationCityTerm("")).toBe("");
  });
});

describe("ilikeOrTerm", () => {
  it("escapes ILIKE wildcards so they match literally", () => {
    expect(ilikeOrTerm("100%_real")).toBe("100\\%\\_real");
    expect(ilikeOrTerm("back\\slash")).toBe("back\\\\slash");
  });

  it("keeps ordinary names intact", () => {
    expect(ilikeOrTerm("São Paulo")).toBe("São Paulo");
    expect(ilikeOrTerm("Kraków")).toBe("Kraków");
  });
});

describe("the assistant route", () => {
  it("builds its destination or() from the escaped city term", () => {
    const src = readFileSync(join(process.cwd(), "app/api/ai/assistant/route.ts"), "utf8");
    expect(src).toMatch(/destinationCityTerm\(destinationName\)/);
    expect(src).not.toMatch(/\.or\(`name\.ilike\.%\$\{destinationName\}%/);
  });
});
