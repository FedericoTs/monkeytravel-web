import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from} ${amount}` }) }),
}));
vi.mock("@/lib/stats/useSavedTrips", () => ({ useSavedTrips: () => null }));

import ActivityCard from "./ActivityCard";

const stop = {
  id: "a1",
  name: "Lokál",
  type: "restaurant",
  description: "Czech pub food.",
  location: "Old Town",
  start_time: "13:00",
  time_slot: "afternoon",
  duration_minutes: 60,
  booking_required: false,
  tips: [],
  official_website: "https://example.com",
} as Activity;

afterEach(cleanup);

// Every page that shows this card heads its days at level 2 (the day header, Today, the trip
// under way), so a screen reader moving by headings lands on each stop under its day.
it("names the stop as a level-3 heading", () => {
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      <ActivityCard activity={stop} index={0} currency="EUR" showGallery={false} />
    </NextIntlClientProvider>
  );
  expect(screen.getByRole("heading", { level: 3, name: "Lokál" })).toBeTruthy();
});
