import { describe, expect, it } from "vitest";
import { destinationProblem, step1Blocker } from "./step1-gate";
import { DESTINATION_MAX_LENGTH } from "@/lib/trips/request-limits";

describe("destinationProblem", () => {
  it.each([
    ["", "short"],
    ["A", "short"],
    ["Lisbon", null],
    ["Zürich", null],
    ["São Paulo, Brazil", null],
    ["Москва", null],
    ["Côte d'Azur (Nice) & Monaco / 2", null],
    ["Paris; DROP TABLE", "chars"],
    ["Tokyo 🗼", "chars"],
  ])("%j → %s", (destination, problem) => {
    expect(destinationProblem(destination)).toBe(problem);
  });

  it("takes up to the server's length, and no more", () => {
    expect(destinationProblem("a".repeat(DESTINATION_MAX_LENGTH))).toBeNull();
    expect(destinationProblem("a".repeat(DESTINATION_MAX_LENGTH + 1))).toBe("long");
  });

  it("names the first rule broken: too short, then too long, then the characters", () => {
    expect(destinationProblem("@")).toBe("short");
    expect(destinationProblem("@".repeat(DESTINATION_MAX_LENGTH + 1))).toBe("long");
  });
});

describe("step1Blocker", () => {
  it("lets a place with a two-day trip or longer through, up to the most days", () => {
    expect(step1Blocker("Lisbon", "2027-05-10", "2027-05-11", 14)).toBeNull();
    expect(step1Blocker("Lisbon", "2027-05-10", "2027-05-23", 14)).toBeNull();
    expect(step1Blocker("Lisbon", "2027-05-10", "2027-05-30", 21)).toBeNull();
  });

  it("asks for dates until there are two days, the end after the start", () => {
    expect(step1Blocker("Lisbon", "", "", 14)).toBe("dates");
    expect(step1Blocker("Lisbon", "2027-05-10", "", 14)).toBe("dates");
    expect(step1Blocker("Lisbon", "2027-05-10", "2027-05-10", 14)).toBe("dates");
    expect(step1Blocker("Lisbon", "2027-05-12", "2027-05-10", 14)).toBe("dates");
  });

  it("stops a trip longer than the most days", () => {
    expect(step1Blocker("Lisbon", "2027-05-10", "2027-05-24", 14)).toBe("too_many_days");
  });

  it("names the destination's problem before the dates'", () => {
    expect(step1Blocker("", "", "", 14)).toBe("short");
    expect(step1Blocker("Paris; DROP TABLE", "2027-05-10", "2027-05-30", 14)).toBe("chars");
  });
});
