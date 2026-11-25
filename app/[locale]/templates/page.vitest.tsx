/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";

const redirected = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock("next/navigation", () => ({
  permanentRedirect: (to: string) => {
    redirected.to.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("./TemplatesPageClient", () => ({ default: () => null }));

const { default: TemplatesPage } = await import("./page");
const { default: TemplatesPageClient } = await import("./TemplatesPageClient");

const open = (locale: string) => TemplatesPage({ params: Promise.resolve({ locale }) });

afterEach(() => {
  vi.unstubAllEnvs();
  redirected.to = [];
});

describe("the templates page", () => {
  it("sends visitors to the planner, in their language, while templates are hidden", async () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "false");
    await expect(open("es")).rejects.toThrow("NEXT_REDIRECT");
    await expect(open("en")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected.to).toEqual(["/es/trips/new", "/trips/new"]);
  });

  it("shows the templates while they are on", async () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "true");
    const page = await open("it");
    expect(isValidElement(page) && page.type).toBe(TemplatesPageClient);
    expect(redirected.to).toEqual([]);
  });
});
