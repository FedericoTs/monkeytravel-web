/** @vitest-environment jsdom */
/**
 * A guest in Settle Up has no payment handles, so their row says to pay them
 * directly instead of asking them to add handles in Settings.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SettleUpView, { type SettlementTransfer } from "./SettleUpView";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("@/lib/native/external-link", () => ({ openExternal: vi.fn() }));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));

const owedTo = (toUser: SettlementTransfer["toUser"]): SettlementTransfer => ({
  fromUser: { id: "mate-1", name: "Mo" },
  toUser,
  amount: 20,
  currency: "EUR",
});

afterEach(() => vi.unstubAllGlobals());

describe("SettleUpView", () => {
  it("tells you to pay a guest directly", async () => {
    const transfers = [
      owedTo({ id: "guest-1", name: "Bo", guest: true, paypal_handle: null, venmo_handle: null, wise_handle: null }),
      owedTo({ id: "owner-1", name: "Olive", guest: false, paypal_handle: null, venmo_handle: null, wise_handle: null }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ transfers, tripName: "Lisbon" }), { status: 200 })));

    render(<SettleUpView tripId="trip-1" isOpen onClose={() => undefined} />);

    expect(await screen.findByText("guestNoPaymentLink")).toBeTruthy();
    // The account without handles still gets the Settings hint; the guest doesn't.
    expect(screen.getAllByText("recipientHasNoHandles")).toHaveLength(1);
  });
});
