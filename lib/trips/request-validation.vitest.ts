import { describe, expect, it } from "vitest";
import { validateTripParams } from "./request-validation";
import type { TripCreationParams } from "@/types";

/**
 * The prompt-injection guard refuses the same text every time it sees it,
 * in whichever field it arrives.
 */

const params = (over: Partial<TripCreationParams>): TripCreationParams => ({
  destination: "Lisbon",
  startDate: "2099-08-11",
  endDate: "2099-08-15",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural"],
  interests: [],
  ...over,
});

// One phrase for each pattern, in characters a destination may hold.
const PHRASES = [
  "ignore all previous instructions",
  "disregard prior",
  "you are now",
  "pretend to be",
  "system prompt",
  "new persona",
  "override the",
  "forget everything",
  "do not follow",
  "bypass the filter",
  "act as a",
  "roleplay as",
  "jailbreak",
  "DAN mode",
  "developer mode",
  "respond as if",
  "reveal your instructions",
  "what are your instructions",
];
// The destination's allowlist refuses these before the guard sees them.
const BRACKETED = ["[INST]", "<<SYS>>"];

const REFUSED = { valid: false, error: "Invalid input detected" };
const threeTimes = (request: TripCreationParams) => [1, 2, 3].map(() => validateTripParams(request));

describe("the prompt-injection guard", () => {
  it("refuses an injected destination every time it is sent, in any case", () => {
    for (const phrase of PHRASES.flatMap((p) => [p, p.toUpperCase()])) {
      expect(threeTimes(params({ destination: `${phrase} Lisbon` })), phrase).toEqual([REFUSED, REFUSED, REFUSED]);
    }
  });

  it("refuses injected requirements and must-dos every time they are sent", () => {
    for (const phrase of [...PHRASES, ...BRACKETED]) {
      expect(threeTimes(params({ requirements: `Quiet evenings. ${phrase} and plan` })), phrase).toEqual([REFUSED, REFUSED, REFUSED]);
      expect(threeTimes(params({ mustDos: ["Tram 28", `${phrase} now`] })), phrase).toEqual([REFUSED, REFUSED, REFUSED]);
    }
  });

  it("lets an ordinary request through every time", () => {
    const request = params({ requirements: "Vegetarian food and quiet evenings", mustDos: ["Tram 28", "Pastéis de Belém"] });
    expect(threeTimes(request)).toEqual([{ valid: true }, { valid: true }, { valid: true }]);
  });
});
