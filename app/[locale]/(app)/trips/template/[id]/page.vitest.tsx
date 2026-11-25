/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";

const redirected = vi.hoisted(() => ({ to: [] as string[] }));
const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("next/navigation", () => ({
  permanentRedirect: (to: string) => {
    redirected.to.push(to);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    // Like the database, only the columns the page asks for come back.
    let columns: string[] = [];
    const query = {
      select: (cols: string) => {
        columns = cols.split(",").map((c) => c.trim());
        return query;
      },
      eq: () => query,
      single: async () =>
        row.current
          ? { data: Object.fromEntries(Object.entries(row.current).filter(([k]) => columns.includes(k))), error: null }
          : { data: null, error: { code: "PGRST116" } },
    };
    return { from: () => query };
  },
}));
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshItineraryPhotos: async (days: unknown) => days }));
vi.mock("./TemplatePreviewClient", () => ({ default: () => null }));

const { default: TemplatePage } = await import("./page");
const { default: TemplatePreviewClient } = await import("./TemplatePreviewClient");

const KYOTO = {
  id: "tpl-kyoto",
  title: "Kyoto Trip",
  description: "Temples and gardens",
  itinerary: [],
  trip_meta: { locale: "it" },
  template_destination: "Kyoto",
  template_duration_days: 5,
  public_slug: "kyoto-1a2b3c4d",
};

const open = (locale = "en") => TemplatePage({ params: Promise.resolve({ id: "tpl-kyoto", locale }) });

afterEach(() => {
  vi.unstubAllEnvs();
  redirected.to = [];
  row.current = null;
});

describe("a template's page", () => {
  it("sends visitors to the trip's public page while templates are hidden", async () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "false");
    row.current = KYOTO;
    await expect(open()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected.to).toEqual(["/it/trip/kyoto-1a2b3c4d"]);
  });

  it("sends them to the planner when the template has no public page", async () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "false");
    row.current = { ...KYOTO, public_slug: null };
    await expect(open("pt")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected.to).toEqual(["/pt/trips/new"]);
  });

  it("still answers a template that doesn't exist with not found", async () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "false");
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(redirected.to).toEqual([]);
  });

  it("shows the template while templates are on", async () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "true");
    row.current = KYOTO;
    const page = await open("es");
    expect(isValidElement(page) && page.type).toBe(TemplatePreviewClient);
    expect(redirected.to).toEqual([]);
  });
});
