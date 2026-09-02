/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars?.destination ? `${key}[${vars.destination}]` : key,
}));

import PendingClaimBanner from "./PendingClaimBanner";

const pending = {
  tripId: "trip-1",
  shareToken: "tok",
  shareUrl: "https://monkeytravel.app/shared/tok",
  destination: "Lisbon",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  days: 3,
  createdAt: "2026-09-02T12:00:00.000Z",
};

describe("PendingClaimBanner", () => {
  it("names the destination, keeps on the primary action, and links the share URL", () => {
    const onKeep = vi.fn();
    const onOpenLink = vi.fn();
    const onDismiss = vi.fn();
    render(<PendingClaimBanner pending={pending} onKeep={onKeep} onOpenLink={onOpenLink} onDismiss={onDismiss} />);
    expect(screen.getByRole("status").textContent).toContain("wizard.pendingClaim.title[Lisbon]");
    fireEvent.click(screen.getByText("wizard.pendingClaim.keep"));
    expect(onKeep).toHaveBeenCalledTimes(1);
    const link = screen.getByText("wizard.pendingClaim.openLink") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(pending.shareUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    fireEvent.click(link);
    expect(onOpenLink).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("wizard.pendingClaim.dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("falls back to the generic title when the destination is unknown", () => {
    render(<PendingClaimBanner pending={{ ...pending, destination: "" }} onKeep={() => {}} onOpenLink={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("wizard.pendingClaim.titleGeneric");
  });
});
