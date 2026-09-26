/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";

/**
 * A bank activity is offered only when it answers the request. The bank
 * matches on any one shared word, so a long message matched anything: the
 * assistant offered "Traditional Roman Aperitivo in Monti" for "add the part
 * where we go to civitavecchia port" (production, 2026-09-20 and 2026-09-26).
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
