// @vitest-environment node
import { describe, expect, it } from "vitest";
import en from "@/messages/en/bananas.json";
import es from "@/messages/es/bananas.json";
import itBananas from "@/messages/it/bananas.json";
import pt from "@/messages/pt/bananas.json";

/**
 * The tier list under the badge names each tier as the badge does: the
 * locale's own tierNames, and its own word for referrals.
 */
describe.each(Object.entries({ en, es, it: itBananas, pt }))("bananas copy in %s", (_locale, messages) => {
  const { tierNames, benefits, tier } = messages;

  it("names each tier as its badge does", () => {
    expect(benefits.explorer.startsWith(`${tierNames.explorer} (`)).toBe(true);
    expect(benefits.ambassador.startsWith(`${tierNames.ambassador} (`)).toBe(true);
    expect(benefits.champion.startsWith(`${tierNames.champion} (`)).toBe(true);
    expect(tier.maxTierReached).toContain(tierNames.champion);
  });

  it("counts referrals with the same word as the milestones", () => {
    for (const line of [benefits.explorer, benefits.ambassador, benefits.champion]) {
      expect(line).toMatch(new RegExp(`\\(\\d+ ${tier.refs.replace(".", "\\.")}\\)`));
    }
  });
});
