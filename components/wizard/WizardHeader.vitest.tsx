import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import WizardHeader from "./WizardHeader";

afterEach(cleanup);

describe("WizardHeader", () => {
  it("leads back home, or to their trips once signed in", () => {
    render(<WizardHeader isAuthenticated={false} step={1} totalSteps={2} />);
    expect(screen.getByRole("link", { name: "wizard.back" }).getAttribute("href")).toBe("/");
    cleanup();

    render(<WizardHeader isAuthenticated step={1} totalSteps={2} />);
    expect(screen.getByRole("link", { name: "wizard.back" }).getAttribute("href")).toBe("/trips");
  });

  // On a phone only the arrow shows: the word stays for screen readers, so the way back keeps its name.
  it("keeps its name on a phone, the arrow left out of it", () => {
    const { container } = render(<WizardHeader isAuthenticated={false} step={1} totalSteps={2} />);
    const word = screen.getByText("wizard.back");
    expect(word.className.split(/\s+/)).toContain("sr-only");
    expect(word.className.split(/\s+/)).not.toContain("hidden");
    expect(container.querySelector("header a svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the steps reached so far", () => {
    const { container } = render(<WizardHeader isAuthenticated={null} step={2} totalSteps={3} />);
    const bars = [...container.querySelectorAll("header .rounded-full")];
    expect(bars.map((bar) => bar.classList.contains("w-8"))).toEqual([true, true, false]);
    expect(screen.getByText("2/3")).toBeTruthy();
  });
});
