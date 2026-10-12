import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

/**
 * Chrome counts a visible fixed element whose top or bottom changes as a
 * layout shift, even when a scroll caused it. It does not count an element
 * that is newly inserted, nor one moved by a transform. On phones the bar
 * opens at the top and moves to the bottom on the first scroll, and at the
 * bottom it rides above bars that come and go while the visitor scrolls.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/blog/a-post",
}));
vi.mock("@/lib/consent", () => ({
  useConsent: () => ({
    bannerStatus: "visible",
    acceptAll: vi.fn(),
    acceptEssentialOnly: vi.fn(),
    openSettings: vi.fn(),
  }),
}));
vi.mock("@/lib/consent/consent-event-client", () => ({
  buildConsentEvent: vi.fn(() => ({})),
  sendConsentEvent: vi.fn(),
}));

import { CookieConsentBanner } from "./CookieConsentBanner";
import { ConsentMiniBar } from "./ConsentMiniBar";

/** The fixed wrapper, which is what moves. */
const fixedBar = () => screen.getByTestId("consent-mini").parentElement as HTMLElement;

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true });
  window.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  // A phone: jsdom has no matchMedia.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
  scrollTo(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("phone consent bar and layout shift", () => {
  it("moves from top to bottom as a new element, not by changing the old one's position", async () => {
    render(<CookieConsentBanner />);
    await screen.findByTestId("consent-mini");
    const top = fixedBar();
    expect(top.className).toContain("top-3");

    await act(async () => scrollTo(500));

    const bottom = fixedBar();
    expect(bottom.className).not.toContain("top-3");
    expect(bottom).not.toBe(top);
    expect(top.isConnected).toBe(false);
  });

  it("is lifted above the page's bottom bars by a translate, never by its bottom offset", () => {
    render(<ConsentMiniBar onWizard={false} />);
    const lifts = fixedBar().className.split(/\s+/).filter((c) => c.includes("--mt-"));
    expect(lifts.length).toBeGreaterThan(0);
    for (const c of lifts) expect(c).toMatch(/^-translate-y-\[/);
  });
});
