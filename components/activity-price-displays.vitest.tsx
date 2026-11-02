import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from}→GBP ${amount}` }) }),
}));
vi.mock("@/lib/stats/useSavedTrips", () => ({ useSavedTrips: () => null }));

import ActivityCard from "./ActivityCard";
import ActivityDetailSheet from "./ui/ActivityDetailSheet";
import { MiniActivityCard } from "./ai/AssistantCards";

/**
 * Every place an activity's price shows uses the viewer's currency
 * (lib/i18n/activity-price.ts), not the estimate's own.
 */
const activity = (estimated_cost?: Activity["estimated_cost"]) =>
  ({
    id: "a1",
    name: "Torre de Belém",
    type: "landmark",
    description: "A fort on the Tagus.",
    location: "Belém",
    start_time: "09:30",
    time_slot: "morning",
    duration_minutes: 90,
    estimated_cost,
    booking_required: false,
    tips: [],
  }) as Activity;

const shown = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      {node}
    </NextIntlClientProvider>
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an activity's price wherever it shows", () => {
  const priced = activity({ amount: 12, currency: "EUR", tier: "budget" });

  it("is converted on the activity card", () => {
    shown(<ActivityCard activity={priced} index={0} currency="USD" showGallery={false} />);
    expect(screen.getByText("EUR→GBP 12")).toBeTruthy();
  });

  it("is converted in the details sheet, and a dash when there is no estimate", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    shown(<ActivityDetailSheet activity={priced} isOpen onClose={() => {}} />);
    expect(screen.getByText("EUR→GBP 12")).toBeTruthy();
    cleanup();
    shown(<ActivityDetailSheet activity={activity(undefined)} isOpen onClose={() => {}} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("is converted on the assistant's preview card, and free at 0", () => {
    shown(<MiniActivityCard activity={priced} />);
    expect(screen.getByText("EUR→GBP 12")).toBeTruthy();
    cleanup();
    shown(<MiniActivityCard activity={activity({ amount: 0, currency: "EUR", tier: "free" })} />);
    expect(screen.getByText(enCommon.activity.free)).toBeTruthy();
  });
});
