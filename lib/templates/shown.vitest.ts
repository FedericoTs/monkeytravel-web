import { afterEach, describe, expect, it, vi } from "vitest";
import { templatesShown } from "./shown";

afterEach(() => vi.unstubAllEnvs());

describe("templatesShown", () => {
  it("is off unless the switch says exactly true", () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", undefined);
    expect(templatesShown()).toBe(false);
    for (const value of ["", "1", "yes", "TRUE", "false"]) {
      vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", value);
      expect(templatesShown()).toBe(false);
    }
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "true");
    expect(templatesShown()).toBe(true);
  });
});
