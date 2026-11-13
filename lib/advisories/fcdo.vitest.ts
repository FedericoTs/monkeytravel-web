/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { countryNameToFcdoSlug, deriveAdvice, getFcdoAdvisory } from "./fcdo";

describe("the UK's advice, in its own terms", () => {
  it.each([
    [["avoid_all_travel_to_whole_country"], "extreme", "all_whole"],
    [["avoid_all_but_essential_travel_to_whole_country"], "high", "essential_whole"],
    [["avoid_all_travel_to_parts"], "high", "all_parts"],
    [["avoid_all_travel_to_parts", "avoid_all_but_essential_travel_to_parts"], "high", "all_parts"],
    [["avoid_all_but_essential_travel_to_parts"], "advisory", "essential_parts"],
    [["avoid_all_travel_to_parts", "avoid_all_but_essential_travel_to_whole_country"], "high", "essential_whole"],
    [["AVOID_ALL_TRAVEL_TO_PARTS"], "high", "all_parts"],
    [["something_new"], "advisory", "other"],
    [undefined, "extreme", "other"],
  ] as const)("%j at %s is %s", (tags, level, advice) => {
    expect(deriveAdvice(tags ? [...tags] : undefined, level)).toBe(advice);
  });

  it("is nothing at the lowest level", () => {
    expect(deriveAdvice([], "low")).toBeNull();
    expect(deriveAdvice(["avoid_all_travel_to_parts"], "low")).toBeNull();
  });
});

describe("the advice page a destination is looked up on", () => {
  it.each([
    ["Istanbul, Turkey", "turkey"],
    ["Rio de Janeiro, Brazil", "brazil"],
    ["New York, United States", "usa"],
    ["Thailand", "thailand"],
  ])("%s is read from %s", (destination, slug) => {
    expect(countryNameToFcdoSlug(destination)).toBe(slug);
  });
});

describe("an advisory read from the UK", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("carries its level and the advice in the UK's terms", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return new Response(
        JSON.stringify({
          title: "Atlantis travel advice",
          base_path: "/foreign-travel-advice/atlantis",
          description: "FCDO travel advice for Atlantis.",
          public_updated_at: "2026-10-01T00:00:00Z",
          details: { alert_status: ["avoid_all_travel_to_parts"] },
        })
      );
    });
    const advisory = await getFcdoAdvisory("Port Royal, Atlantis");
    expect(asked).toEqual(["https://www.gov.uk/api/content/foreign-travel-advice/atlantis"]);
    expect(advisory).toMatchObject({ countryName: "Atlantis", level: "high", advice: "all_parts" });
  });
});
