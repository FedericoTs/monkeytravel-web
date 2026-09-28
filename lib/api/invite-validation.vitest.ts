import { describe, it, expect, vi, afterEach } from "vitest";
import { validateInvite, type InviteData } from "./invite-validation";

const base: InviteData = {
  id: "inv-1",
  trip_id: "trip-1",
  token: "abcdefghijkl",
  role: "editor",
  created_by: "user-1",
  created_at: "2026-09-01T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
  max_uses: 5,
  use_count: 0,
  is_active: true,
};

afterEach(() => vi.restoreAllMocks());

describe("validateInvite", () => {
  it("accepts a usable invite", () => {
    expect(validateInvite(base)).toEqual({ valid: true });
  });

  it.each([
    ["MAX_USES", { ...base, use_count: 5 }, 410],
    ["REVOKED", { ...base, is_active: false }, 410],
    ["EXPIRED", { ...base, expires_at: "2020-01-01T00:00:00Z" }, 410],
    ["NOT_FOUND", null, 404],
  ] as const)("reports %s and builds its response only when asked", async (code, invite, status) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = validateInvite(invite);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(code);
    // Reading the code, as the invite page does, must not log an API error.
    expect(consoleError).not.toHaveBeenCalled();

    const response = result.errorResponse!();
    expect(response.status).toBe(status);
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("calls a used-up invite used, even when it was also revoked", () => {
    expect(validateInvite({ ...base, use_count: 5, is_active: false }).errorCode).toBe("MAX_USES");
  });
});
