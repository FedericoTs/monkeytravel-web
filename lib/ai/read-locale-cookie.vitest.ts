/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

let cookieValue: string | undefined;
let cookiesThrow = false;
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (cookiesThrow) throw new Error("outside a request");
    return { get: (name: string) => (name === "NEXT_LOCALE" && cookieValue !== undefined ? { value: cookieValue } : undefined) };
  },
}));

import { readLocaleCookie } from "./user-context";

beforeEach(() => {
  cookieValue = undefined;
  cookiesThrow = false;
});

describe("readLocaleCookie", () => {
  it("reads a supported locale, and a regional tag by its base language", async () => {
    cookieValue = "es";
    expect(await readLocaleCookie()).toBe("es");
    cookieValue = "pt-BR";
    expect(await readLocaleCookie()).toBe("pt");
  });

  it("is null, not English, without a usable cookie, so callers can fall back further", async () => {
    expect(await readLocaleCookie()).toBeNull();
    cookieValue = "de";
    expect(await readLocaleCookie()).toBeNull();
    cookieValue = "  ";
    expect(await readLocaleCookie()).toBeNull();
    cookiesThrow = true;
    expect(await readLocaleCookie()).toBeNull();
  });
});
