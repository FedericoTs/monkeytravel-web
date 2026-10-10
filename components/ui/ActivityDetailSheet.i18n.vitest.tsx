import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itCommon from "@/messages/it/common.json";
import itTrips from "@/messages/it/trips.json";
import type { Activity } from "@/types";
import ActivityDetailSheet from "./ActivityDetailSheet";

/**
 * The sheet "More" opens on phones had no translations at all: every label,
 * button and the "Free" cost read in English on /it, /es and /pt.
 */
const activity = {
  id: "a1",
  name: "Torre di Belém",
  type: "landmark",
  description: "Fortezza sul Tago.",
  location: "Belém, Lisbona",
  start_time: "09:30",
  duration_minutes: 90,
  estimated_cost: { amount: 0, currency: "EUR", tier: "free" },
  booking_required: true,
  tips: ["Arriva all'apertura"],
} as unknown as Activity;

afterEach(() => vi.unstubAllGlobals());

describe("ActivityDetailSheet in Italian", () => {
  it("labels everything from the message files", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(
      <NextIntlClientProvider locale="it" messages={{ common: itCommon, trips: itTrips }}>
        <ActivityDetailSheet activity={activity} isOpen onClose={() => {}} />
      </NextIntlClientProvider>
    );

    for (const label of [
      itCommon.activity.booking,
      itCommon.activity.startTime,
      itCommon.activity.estCost,
      itCommon.activity.free,
      itCommon.activity.about,
      itCommon.activity.location,
      itCommon.activity.photos,
      itCommon.activity.insiderTips,
      itCommon.map.openInMaps,
      itCommon.buttons.verify,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("90 min")).toBeTruthy();
    expect(screen.getByLabelText(itCommon.buttons.close)).toBeTruthy();

    const text = document.body.textContent ?? "";
    for (const english of ["Booking Required", "Start Time", "Est. Cost", "About", "Insider Tips", "Open in Maps", "duration"]) {
      expect(text).not.toContain(english);
    }
  });
});
