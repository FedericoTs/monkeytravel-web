import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import type { ReactNode } from "react";
import Step1Notices from "./Step1Notices";

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

const plan = (token: string, destination: string) => ({ token, destination, startDate: "2027-05-12", endDate: "2027-05-15", dayCount: 4, expiresAt: "2099-01-01T00:00:00.000Z" });

function notices(handleOpenKeptPlan = vi.fn(async () => {})) {
  render(
    <NextIntlClientProvider locale="en" messages={{ trips: enTrips }} onError={() => {}}>
      <Step1Notices
        claimedTripId={null}
        dismissClaimedTrip={vi.fn()}
        showPendingClaimBanner={false}
        pendingClaim={null}
        handlePendingClaimAction={vi.fn()}
        isExpired={false}
        draft={null}
        generatedItinerary={null}
        keptPlanGone={false}
        isAuthenticated={false}
        keptPlans={[plan("LISBONxxxxxxxxxxxxxxxx", "Lisbon, Portugal"), plan("PORTOxxxxxxxxxxxxxxxxx", "Porto, Portugal")]}
        locale="en"
        openingKeptPlan={null}
        handleOpenKeptPlan={handleOpenKeptPlan}
        showDraftRecovery={false}
        handleRestoreDraft={vi.fn()}
        handleDiscardDraft={vi.fn()}
      />
    </NextIntlClientProvider>
  );
  return handleOpenKeptPlan;
}

describe("Step1Notices' kept plans", () => {
  it("open the latest from its card and an older one from the list, each saying where from", () => {
    const open = notices();
    fireEvent.click(screen.getByRole("button", { name: "Open my plan" }));
    expect(open).toHaveBeenLastCalledWith("LISBONxxxxxxxxxxxxxxxx", "card");
    fireEvent.click(screen.getByRole("button", { name: /^Porto/ }));
    expect(open).toHaveBeenLastCalledWith("PORTOxxxxxxxxxxxxxxxxx", "list");
  });
});
