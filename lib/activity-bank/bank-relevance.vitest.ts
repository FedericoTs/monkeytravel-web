/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";

/**
 * A bank activity is offered only when it answers the request. The bank
 * matches on any one shared word, so a long message would match anything,
 * e.g. "Traditional Roman Aperitivo in Monti" for a cruise-port transfer.
 */

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { isRelevantBankMatch } from "./index";

describe("isRelevantBankMatch", () => {
  it("rejects the aperitivo offered for a cruise-port transfer", () => {
    expect(
      isRelevantBankMatch(
        "Traditional Roman Aperitivo in Monti",
        "okay everything is messed up. I need to get rid of day 5 info and add the part where we go to civitavecchia port"
      )
    ).toBe(false);
  });

  it("rejects a long message even when a word happens to overlap", () => {
    expect(
      isRelevantBankMatch(
        "Civitavecchia Port Walk",
        "okay everything is messed up. I need to get rid of day 5 info and add the part where we go to civitavecchia port"
      )
    ).toBe(false);
  });

  it("accepts a short request that the activity's name answers", () => {
    expect(isRelevantBankMatch("Gelato at Giolitti", "gelato")).toBe(true);
    expect(isRelevantBankMatch("Pizza tasting in Trastevere", "a pizza place")).toBe(true);
  });

  it("rejects a short request the name doesn't answer", () => {
    expect(isRelevantBankMatch("Traditional Roman Aperitivo in Monti", "coffee stop")).toBe(false);
  });

  it("rejects nothing to go on", () => {
    expect(isRelevantBankMatch(undefined, "gelato")).toBe(false);
    expect(isRelevantBankMatch("Gelato at Giolitti", "add something")).toBe(false);
  });
});
