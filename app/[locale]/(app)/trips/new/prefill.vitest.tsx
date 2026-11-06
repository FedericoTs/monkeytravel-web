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
