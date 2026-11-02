/** @vitest-environment node */
import { describe, it, expect, afterEach, vi } from "vitest";
import { refuseUnlessCron } from "./cron-auth";

const call = (authorization?: string) =>
  refuseUnlessCron(new Request("https://monkeytravel.app/api/cron/x", authorization === undefined ? {} : { headers: { authorization } }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refuseUnlessCron", () => {
  it("lets the cron's own bearer token through", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect(call("Bearer s3cret-value")).toBeNull();
  });

  it("refuses anything else with a 401", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    // Headers trim surrounding whitespace themselves, so "…value " never reaches the check.
    for (const header of [undefined, "", "Bearer", "Bearer ", "Bearer s3cret-valu", "Bearer s3cret-value2", "Bearer  s3cret-value", "bearer s3cret-value", "s3cret-value"]) {
      const res = call(header);
      expect(res?.status, String(header)).toBe(401);
      expect(await res!.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("refuses every request when no secret is set, even one that sends none", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(call("Bearer ")?.status).toBe(401);
    expect(call("Bearer undefined")?.status).toBe(401);
    expect(call()?.status).toBe(401);
  });
});
