import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from} ${amount}` }) }),
}));
vi.mock("@/lib/stats/useSavedTrips", () => ({ useSavedTrips: () => null }));

import ActivityCard from "./ActivityCard";

/**
 * A card's photo is named for the place only when it is the place's own: a
 * stock picture of a table isn't Lokál, so a screen reader isn't told it is.
 */
const stop = (image_url: string) =>
  ({
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
    image_url,
  }) as Activity;

const photoAlt = (image_url: string) => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      <ActivityCard activity={stop(image_url)} index={0} currency="EUR" showGallery={false} />
    </NextIntlClientProvider>
  );
  return container.querySelector("img")?.getAttribute("alt");
};

afterEach(cleanup);

it("names the place's own photo, and leaves a stock picture unnamed", () => {
  expect(photoAlt("/api/images/wikimedia/abc-500.jpg?a=X&l=CC0&f=Y.jpg")).toBe("Lokál");
  cleanup();
  expect(photoAlt("https://images.pexels.com/photos/1/a.jpeg")).toBe("");
});
