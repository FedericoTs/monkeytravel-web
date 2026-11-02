import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

/**
 * A phone's consent bar opens at the top and minimises to the bottom on the
 * visitor's first interaction. If it moved while a finger was still down, the
 * tap would end on the bar and never reach the button it started on.
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

/** The fixed wrapper, which is what moves. */
const fixedBar = () => screen.getByTestId("consent-mini").parentElement as HTMLElement;

beforeEach(() => {
  // A phone: jsdom has no matchMedia.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("phone consent bar and the visitor's first tap", () => {
  it("stays put while the finger is down, and moves once the tap has reached its button", async () => {
    const onTap = vi.fn();
    render(
      <>
        <CookieConsentBanner />
        <main>
          <button onClick={onTap}>Table of Contents</button>
        </main>
      </>
    );
    await screen.findByTestId("consent-mini");
    const top = fixedBar();
    expect(top.className).toContain("top-3");
    const button = screen.getByRole("button", { name: "Table of Contents" });

    await act(async () => {
      fireEvent.pointerDown(button);
    });
    expect(fixedBar()).toBe(top);

    await act(async () => {
      fireEvent.click(button);
    });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(fixedBar().className).not.toContain("top-3");
  });
});
