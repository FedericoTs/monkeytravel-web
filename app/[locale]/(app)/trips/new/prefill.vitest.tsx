// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { MUST_DOS_MAX, MUST_DO_MAX_LENGTH } from "@/lib/trips/request-limits";

/** The places a link asks the planner to keep are cleaned here, before the wizard sees them. */

vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@/lib/destinations/data", () => ({ getDestinationBySlug: () => undefined }));
vi.mock("./NewTripWizard", () => ({ default: () => null }));

const { default: NewTripPage } = await import("./page");

const mustDosFor = async (must?: string | string[]) => {
  const page = await NewTripPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ must }) });
  if (!isValidElement(page)) throw new Error("no element");
  return (page.props as { prefilledTripShape: { mustDos: string[] } }).prefilledTripShape.mustDos;
};

describe("places to keep, from a link", () => {
  it("none without any", async () => {
    expect(await mustDosFor()).toEqual([]);
  });

  it("takes one or several", async () => {
    expect(await mustDosFor("Colosseum")).toEqual(["Colosseum"]);
    expect(await mustDosFor(["Colosseum", "Da Enzo"])).toEqual(["Colosseum", "Da Enzo"]);
  });

  it("trims them and drops empty ones", async () => {
    expect(await mustDosFor(["  Colosseum ", "   "])).toEqual(["Colosseum"]);
  });

  it("holds them to what the server takes", async () => {
    const many = Array.from({ length: MUST_DOS_MAX + 2 }, (_, i) => `Place ${i}`);
    expect(await mustDosFor(many)).toHaveLength(MUST_DOS_MAX);
    expect((await mustDosFor("x".repeat(MUST_DO_MAX_LENGTH + 5)))[0]).toHaveLength(MUST_DO_MAX_LENGTH);
  });
});

const monthFor = async (month?: string | string[]) => {
  const page = await NewTripPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ month }) });
  if (!isValidElement(page)) throw new Error("no element");
  return (page.props as { prefilledTripShape: { month: number | null } }).prefilledTripShape.month;
};

describe("the month a link plans for", () => {
  it("takes 1 to 12", async () => {
    expect(await monthFor("1")).toBe(1);
    expect(await monthFor("3")).toBe(3);
    expect(await monthFor("12")).toBe(12);
    expect(await monthFor(["10", "2"])).toBe(10);
  });

  it("drops anything else", async () => {
    expect(await monthFor()).toBeNull();
    for (const bad of ["0", "13", "march", "3.5", "-3", "03x", "", " 3"]) {
      expect(await monthFor(bad), bad).toBeNull();
    }
  });
});
