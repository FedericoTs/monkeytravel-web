/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { MARKETING_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";

/**
 * The locale error page and the 404 page speak the visitor's language. Both
 * render under the locale layout's provider, so they are rendered here with
 * exactly the messages that provider serializes.
 */

vi.mock("@/lib/i18n/navigation", () => ({
  NavigationLink: ({ children, prefetch: _prefetch, ...props }: { children: ReactNode; prefetch?: unknown; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock("@/lib/observability/report-boundary-error", () => ({ reportBoundaryError: vi.fn() }));

import { reportBoundaryError } from "@/lib/observability/report-boundary-error";
import LocaleError from "./error";
import NotFound from "./not-found";

const LOCALES = ["en", "es", "it", "pt"] as const;
const clientMessages = (locale: string) =>
  pickMessages(
    { common: JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8")) as AbstractIntlMessages },
    MARKETING_CLIENT_NAMESPACES,
  );
const copy = (locale: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8")) as {
    errorPage: Record<string, string>;
    notFoundPage: Record<string, string>;
  };
const inLocale = (locale: string, ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale={locale} messages={clientMessages(locale)}>
      {ui}
    </NextIntlClientProvider>,
  );

describe.each(LOCALES)("in %s", (locale) => {
  it("the error page says what went wrong, offers a retry and a way home, and shows the error id", () => {
    const { errorPage } = copy(locale);
    const { container } = inLocale(locale, <LocaleError error={Object.assign(new Error("boom"), { digest: "abc123" })} reset={() => {}} />);
    expect(screen.getByRole("heading").textContent).toBe(errorPage.title);
    expect(screen.getByText(errorPage.body)).toBeTruthy();
    expect(screen.getByRole("button").textContent).toBe(errorPage.retry);
    expect(screen.getByText(errorPage.home).getAttribute("href")).toBe("/");
    expect(container.textContent).toContain(errorPage.errorId.replace("{digest}", "abc123"));
    expect(container.textContent).not.toMatch(/errorPage\./);
  });

  it("the 404 page explains, and links home and to a new trip", () => {
    const { notFoundPage } = copy(locale);
    const { container } = inLocale(locale, <NotFound />);
    expect(screen.getByAltText(notFoundPage.imageAlt)).toBeTruthy();
    expect(screen.getByText(notFoundPage.body)).toBeTruthy();
    expect(screen.getByText(notFoundPage.home).closest("a")?.getAttribute("href")).toBe("/");
    const planTrip = notFoundPage.planTrip.match(/<link>(.*)<\/link>/)![1];
    expect(screen.getByText(planTrip).getAttribute("href")).toBe("/trips/new");
    expect(container.textContent).not.toMatch(/notFoundPage\.|<link>/);
  });
});

it("reports the crash under the locale root's tag", () => {
  const error = new Error("boom");
  inLocale("en", <LocaleError error={error} reset={() => {}} />);
  expect(reportBoundaryError).toHaveBeenCalledWith(error, "locale-root-error");
});
