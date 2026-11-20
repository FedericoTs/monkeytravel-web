import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from} ${amount}` }) }),
}));

import EditableActivityCard from "./EditableActivityCard";

const stop: Activity = {
  id: "a1",
  time_slot: "morning",
  start_time: "09:00",
  duration_minutes: 90,
  name: "Fushimi Inari",
  type: "attraction",
  description: "Thousands of torii gates.",
  location: "Fushimi",
  image_url: "/api/images/wikimedia/abc123-500.jpg",
  tips: [],
  booking_required: false,
  estimated_cost: { amount: 0, currency: "USD", tier: "free" },
};

function photo(photoFirst?: boolean) {
  const { container, unmount } = render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      <EditableActivityCard
        activity={stop}
        index={0}
        showGallery={false}
        photoFirst={photoFirst}
        isEditMode={false}
        onDelete={() => {}}
        onUpdate={() => {}}
        onMoveToDay={() => {}}
        onRegenerate={() => {}}
        availableDays={[1]}
        currentDayIndex={0}
      />
    </NextIntlClientProvider>
  );
  const img = container.querySelector("img[alt='Fushimi Inari']") as HTMLImageElement;
  const out = { loading: img.getAttribute("loading"), priority: img.getAttribute("fetchpriority") };
  unmount();
  return out;
}

describe("a stop card's photo", () => {
  // Lazily, the page's first photo started seconds after the page: it is what the page waits on to look loaded.
  it("is fetched at once, ahead of the rest, when it is the page's first", () => {
    expect(photo(true)).toEqual({ loading: "eager", priority: "high" });
  });

  it("waits until it is near the screen otherwise", () => {
    expect(photo()).toEqual({ loading: "lazy", priority: "auto" });
    expect(photo(false)).toEqual({ loading: "lazy", priority: "auto" });
  });
});
