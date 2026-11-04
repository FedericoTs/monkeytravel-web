import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ilikeOrTerm, ilikeSearchTerm } from "./postgrest-filter";

/**
 * Text going into a PostgREST or() filter.
 *
 * "Chennai, India" puts a comma inside or(): PostgREST reads it as a second
 * condition and answers 400.
 */

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

describe("ilikeSearchTerm", () => {
  it("drops dots and brackets, so an abbreviation finds the stored name", () => {
    expect(ilikeSearchTerm("washington d.c.")).toBe("washington dc");
    expect(ilikeSearchTerm("[paris] {tokyo}")).toBe("paris tokyo");
  });

  it("escapes and drops delimiters as ilikeOrTerm does", () => {
    expect(ilikeSearchTerm("paris, france")).toBe("paris france");
    expect(ilikeSearchTerm('"rome" (italy)')).toBe("rome italy");
    expect(ilikeSearchTerm("100%_real\\")).toBe("100\\%\\_real\\\\");
  });

  it("keeps an apostrophe as typed: a filter value is not SQL text", () => {
    expect(ilikeSearchTerm("côte d'ivoire")).toBe("côte d'ivoire");
  });
});

describe("the search routes", () => {
  it("build their ilike filters from ilikeSearchTerm", () => {
    for (const file of ["app/api/destinations/search/route.ts", "app/api/templates/route.ts"]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).toMatch(/ilikeSearchTerm\(/);
      expect(src, file).not.toMatch(/function escapeForPostgrest/);
    }
  });
});
