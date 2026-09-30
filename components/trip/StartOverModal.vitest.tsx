import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import StartOverModal from "./StartOverModal";

/**
 * Starting over after replacing an older trip's plan keeps that trip, so the
 * modal must not promise to discard it or list what will be lost.
 */

function renderModal(props: { wasAutoSaved?: boolean; keepsSavedTrip?: boolean }) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <StartOverModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        destination="Lisbon, Portugal"
        tripDays={3}
        activitiesCount={11}
        {...props}
      />
    </NextIntlClientProvider>
  );
}

describe("Start Over modal", () => {
  it("for a trip this wizard saved, says it will be discarded", () => {
    renderModal({ wasAutoSaved: true });
    expect(screen.getByText(/about to discard your itinerary for Lisbon, Portugal/)).toBeTruthy();
    expect(screen.getByText("You'll lose:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard saved trip" })).toBeTruthy();
  });

  it("for a replaced trip, says the trip stays and nothing is lost", () => {
    renderModal({ keepsSavedTrip: true });
    expect(screen.getByText(/Your trip for Lisbon, Portugal keeps this plan and stays in My Trips/)).toBeTruthy();
    expect(screen.queryByText("You'll lose:")).toBeNull();
    expect(screen.queryByText(/archived for 7 days/)).toBeNull();
    expect(screen.getByRole("button", { name: "Start Fresh" })).toBeTruthy();
  });
});
