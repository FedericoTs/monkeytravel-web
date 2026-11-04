import { describe, expect, it } from "vitest";
import { MUST_DOS_MAX, MUST_DO_MAX_LENGTH } from "@/lib/trips/request-limits";
import { mustDoItem, withMustDo } from "./must-dos";

describe("a typed wish", () => {
  it("is trimmed and loses its trailing commas", () => {
    expect(mustDoItem("  Tram 28,,  ")).toBe("Tram 28");
    expect(mustDoItem("Fado, in Alfama")).toBe("Fado, in Alfama");
    expect(mustDoItem(" ,, ")).toBe("");
  });

  it("is cut to the length the server takes, without a space left at its end", () => {
    expect(mustDoItem("a".repeat(MUST_DO_MAX_LENGTH + 20))).toHaveLength(MUST_DO_MAX_LENGTH);
    expect(mustDoItem(`${"a".repeat(MUST_DO_MAX_LENGTH - 1)} b`)).toBe("a".repeat(MUST_DO_MAX_LENGTH - 1));
  });
});

describe("adding a wish", () => {
  it("skips one already there, in any case", () => {
    expect(withMustDo(["Tram 28"], "tram 28")).toEqual(["Tram 28"]);
    expect(withMustDo(["Tram 28"], "Belém")).toEqual(["Tram 28", "Belém"]);
  });

  it("stops at the server's count", () => {
    const full = Array.from({ length: MUST_DOS_MAX }, (_, i) => `wish ${i}`);
    expect(withMustDo(full, "one more")).toBe(full);
  });
});
