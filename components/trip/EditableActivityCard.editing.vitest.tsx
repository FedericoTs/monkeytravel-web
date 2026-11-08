import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from} ${amount}` }) }),
}));

import EditableActivityCard from "./EditableActivityCard";

const stop = (extra: Partial<Activity> = {}): Activity => ({
  id: "a1",
  time_slot: "afternoon",
  start_time: "12:30",
  duration_minutes: 75,
  name: "Lunch at Nishiki Market",
  type: "restaurant",
  description: "Skewers and pickles.",
  location: "Nakagyo",
  tips: [],
  booking_required: false,
  estimated_cost: { amount: 20, currency: "USD", tier: "moderate" },
  ...extra,
});

function card(activity: Activity) {
  const onUpdate = vi.fn();
  const ui = (a: Activity) => (
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      <EditableActivityCard
        activity={a}
        index={0}
        currency="USD"
        showGallery={false}
        isEditMode
        onDelete={() => {}}
        onUpdate={onUpdate}
        onMoveToDay={() => {}}
        onRegenerate={() => {}}
        availableDays={[1, 2]}
        currentDayIndex={0}
      />
    </NextIntlClientProvider>
  );
  const view = render(ui(activity));
  return { onUpdate, change: (a: Activity) => view.rerender(ui(a)) };
}

const openEditor = () => fireEvent.click(screen.getByRole("button", { name: enTrips.editActivity.editActivity }));
const field = (label: string) => screen.getAllByLabelText(label)[0] as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: enTrips.detail.saveChanges }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

describe("EditableActivityCard's editor", () => {
  // A reorder re-times the stop, a regenerate renames it, an undo restores it:
  // the card stays mounted, and its editor must show the stop as it is now.
  it("opens with the stop as it is now, and saves that", () => {
    const { onUpdate, change } = card(stop());
    change(stop({ start_time: "14:00", name: "Nishiki Market tasting walk" }));

    openEditor();
    expect(field(enCommon.activity.startTime).value).toBe("14:00");
    expect(field(enCommon.addActivity.activityName).value).toBe("Nishiki Market tasting walk");

    fireEvent.click(saveButton());
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ start_time: "14:00", name: "Nishiki Market tasting walk", duration_minutes: 75 }));
  });

  it("saves nothing without a name, a time, or a duration", () => {
    const { onUpdate } = card(stop());
    openEditor();

    type(enCommon.addActivity.activityName, "   ");
    expect(saveButton().disabled).toBe(true);
    type(enCommon.addActivity.activityName, "Gion");

    type(enCommon.activity.startTime, "");
    expect(saveButton().disabled).toBe(true);
    type(enCommon.activity.startTime, "18:00");

    type(enCommon.addActivity.duration, "0");
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(onUpdate).not.toHaveBeenCalled();

    type(enCommon.addActivity.duration, "90");
    expect(saveButton().disabled).toBe(false);
  });

  it("saves the name without the spaces around it", () => {
    const { onUpdate } = card(stop());
    openEditor();
    type(enCommon.addActivity.activityName, "  Gion at dusk ");
    fireEvent.click(saveButton());
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: "Gion at dusk" }));
  });
});
