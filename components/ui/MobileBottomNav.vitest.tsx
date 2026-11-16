import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ children, href, ...rest }: { children?: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/useCssVarHeight", () => ({ useCssVarHeight: () => {} }));

import MobileBottomNav from "./MobileBottomNav";

const tab = (name: string) => within(screen.getByTestId("mobile-bottom-nav")).getByText(name).closest("a") as HTMLAnchorElement;

/**
 * The phone's tab bar. Coral is decoration (DESIGN.md): the lit tab's icon is
 * coral, its label is in the text colour, where it can be read.
 */
describe("the phone tab bar", () => {
  it("lights the page's own tab: a readable label, a coral icon", () => {
    render(<MobileBottomNav activePage="explore" />);
    const lit = tab("explore");
    expect(lit.getAttribute("aria-current")).toBe("page");
    expect(lit.className).toContain("text-[var(--foreground)]");
    expect(lit.className).not.toContain("--primary");
    expect(lit.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--primary)]");
    expect(within(lit).getByText("explore").className).toContain("font-medium");
  });

  it("leaves the other tabs unlit, their icons uncoloured", () => {
    render(<MobileBottomNav activePage="explore" />);
    for (const name of ["home", "myTrips", "profile"]) {
      const other = tab(name);
      expect(other.getAttribute("aria-current")).toBeNull();
      expect(other.className).toContain("text-slate-500");
      expect(other.querySelector("svg")?.getAttribute("class")).not.toContain("--primary");
    }
  });

  it("lights My trips on the owner's trip page, and no tab on a page that isn't one of the five", () => {
    const { unmount } = render(<MobileBottomNav activePage="trip-detail" />);
    expect(tab("myTrips").getAttribute("aria-current")).toBe("page");
    expect(tab("myTrips").className).toContain("text-[var(--foreground)]");
    unmount();
    render(<MobileBottomNav activePage="saved" />);
    expect(screen.getByTestId("mobile-bottom-nav").querySelectorAll("[aria-current]")).toHaveLength(0);
  });

  // A shared or published trip is someone else's: "My trips" lit there told a
  // visitor with no account they were among their own trips.
  it("lights no tab on a trip someone shared", () => {
    render(<MobileBottomNav activePage="shared-trip" />);
    const bar = screen.getByTestId("mobile-bottom-nav");
    expect(bar.querySelectorAll("[aria-current]")).toHaveLength(0);
    expect(tab("myTrips").className).toContain("text-slate-500");
    expect(bar.innerHTML).not.toContain("text-[var(--primary)]");
  });
});
