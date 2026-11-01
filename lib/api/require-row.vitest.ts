// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { requireRow } from "./require-row";

const read = (data: unknown, error: { code?: string; message: string } | null) => Promise.resolve({ data, error });

describe("requireRow", () => {
  it("returns the row", async () => {
    expect(await requireRow("proposal", read({ id: "p1" }, null), "Proposal not found")).toEqual({ row: { id: "p1" }, errorResponse: null });
  });

  it("is a 404 for no row or a malformed id", async () => {
    for (const error of [null, { code: "PGRST116", message: "no rows" }, { code: "22P02", message: "invalid input syntax for type uuid" }]) {
      const { row, errorResponse } = await requireRow("proposal", read(null, error), "Proposal not found");
      expect(row).toBeNull();
      expect(errorResponse?.status).toBe(404);
      expect(await errorResponse?.json()).toMatchObject({ error: "Proposal not found" });
    }
  });

  it("is a 500 when the database refused the read, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { row, errorResponse } = await requireRow("proposal", read(null, { code: "57014", message: "timeout" }), "Proposal not found");
    expect(row).toBeNull();
    expect(errorResponse?.status).toBe(500);
    expect(logged).toHaveBeenCalledWith("[proposal] read failed:", "timeout");
    logged.mockRestore();
  });
});
