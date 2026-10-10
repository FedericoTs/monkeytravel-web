import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enCommon from "@/messages/en/common.json";
import esCommon from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import ptCommon from "@/messages/pt/common.json";

/**
 * A /shared link that no longer resolves, or a share page that crashed, is
 * often the first thing an invited friend sees. Both pages were English in
 * every language.
 */
const COMMON = { en: enCommon, es: esCommon, it: itCommon, pt: ptCommon } as const;
type Locale = keyof typeof COMMON;
let locale: Locale = "it";

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/observability/report-boundary-error", () => ({ reportBoundaryError: vi.fn() }));
// The server pages' translator, from the same message files, in the request's locale.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale, messages: { common: COMMON[locale] }, namespace: namespace as never }),
  };
});

import SharedTripNotFound, { generateMetadata } from "./not-found";
import SharedTripError from "./error";

const ENGLISH = [
  "This shared trip isn’t available",
  "The link may have expired",
  "Plan your own trip",
  "Unable to load this trip",
  "Try again",
  "Go home",
  "Error ID",
];

describe("shared trip link that no longer works", () => {
  it.each(["es", "it", "pt"] as const)("%s: the not-found page has no English", async (l) => {
    locale = l;
    const { container } = render(await SharedTripNotFound());
    for (const english of ENGLISH) expect(container.textContent).not.toContain(english);
    expect(container.textContent).toContain(COMMON[l].shared.unavailable.title);
    expect(screen.getByRole("link").textContent).toContain(COMMON[l].shared.unavailable.cta);
  });

  it("titles the tab in the page's language", async () => {
    locale = "it";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Viaggio non trovato");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("shared trip that failed to load", () => {
  it.each(["es", "it", "pt"] as const)("%s: the error page has no English", (l) => {
    const { container } = render(
      <NextIntlClientProvider locale={l} messages={{ common: COMMON[l] }}>
        <SharedTripError error={Object.assign(new Error("boom"), { digest: "abc123" })} reset={() => {}} />
      </NextIntlClientProvider>
    );
    for (const english of ENGLISH) expect(container.textContent).not.toContain(english);
    const copy = COMMON[l].shared.loadError;
    expect(screen.getByRole("heading").textContent).toBe(copy.title);
    expect(screen.getByRole("button").textContent).toBe(copy.retry);
    expect(container.textContent).toContain("abc123");
  });
});
