/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from "vitest";
import { logReadError } from "./log-read-error";
import { isNoRow } from "./no-row";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logReadError", () => {
  it("logs a read the database refused and hands the result back", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
    expect(logReadError("trip card: owner name", result)).toBe(result);
    expect(logged).toHaveBeenCalledWith("[trip card: owner name] read failed:", "canceling statement due to statement timeout");
  });

  it("stays quiet when the read worked or found no row", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    logReadError("x", { data: [{ id: 1 }], error: null });
    logReadError("x", { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } });
    logReadError("x", { count: 3, error: null });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("isNoRow", () => {
  it("is no row for .single() on zero rows and for an id that can't be a uuid", () => {
    expect(isNoRow({ code: "PGRST116" })).toBe(true);
    expect(isNoRow({ code: "22P02" })).toBe(true);
  });

  it("is a failure for anything else", () => {
    expect(isNoRow({ code: "57014" })).toBe(false);
    expect(isNoRow({})).toBe(false);
    expect(isNoRow(null)).toBe(false);
  });
});
