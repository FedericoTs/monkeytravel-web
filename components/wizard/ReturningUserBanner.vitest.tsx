import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ReturningUserBanner from "./ReturningUserBanner";

describe("ReturningUserBanner", () => {
  it("leads to their trips, and steps aside however it is dismissed", () => {
    const onDismiss = vi.fn();
    render(<ReturningUserBanner onDismiss={onDismiss} />);
    expect(screen.getByRole("link", { name: "wizard.returningUser.goToMyTrips" }).getAttribute("href")).toBe("/trips");
    fireEvent.click(screen.getByRole("button", { name: "wizard.returningUser.startNewTrip" }));
    fireEvent.click(screen.getByRole("button", { name: "wizard.returningUser.dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
