import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";

vi.mock("@/components/ui/DestinationAutocomplete", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Destination" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/wizard/OneTapStarts", () => ({ default: () => null }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import DestinationField from "./DestinationField";

/**
 * A trip typed as a request the planner can't read as a place ("somewhere warm
 * with the kids") isn't left at an error: the words move to the next step's
 * notes in one tap, and someone with no place in mind gets the match.
 */
const REQUEST = "Somewhere warm in Europe with two kids in April, near a beach and not too expensive please";

function field(destination: string, onKeepAsNote = vi.fn()) {
  const props = {
    multiCityMode: false,
    setDestination: vi.fn(),
    trackFieldInteraction: vi.fn(),
    handleDestinationSelect: vi.fn(),
    expressTrip: null,
    locale: "en",
    popularPicks: [],
    inSeasonMonth: null,
    handleOneTapStart: vi.fn(),
    onKeepAsNote,
  };
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ trips: enTrips }}>
      <DestinationField {...props} destination={destination} />
    </NextIntlClientProvider>
  );
  const show = (next: string) =>
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ trips: enTrips }}>
        <DestinationField {...props} destination={next} />
      </NextIntlClientProvider>
    );
  return { onKeepAsNote, show };
}

afterEach(cleanup);

describe("a request typed as the destination", () => {
  it("offers to move it to the next step, and says it did", () => {
    const { onKeepAsNote, show } = field(`${REQUEST} ${REQUEST}`);
    expect(screen.getByText(enTrips.wizard.step1.destinationTooLong)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: enTrips.wizard.step1.keepAsNote }));
    expect(onKeepAsNote).toHaveBeenCalledTimes(1);
    show("");
    expect(screen.getByText(enTrips.wizard.step1.movedToNotes)).toBeTruthy();
    // A place picked without typing (a popular pick) hides it too.
    show("Paris");
    expect(screen.queryByText(enTrips.wizard.step1.movedToNotes)).toBeNull();
    // Typing a place puts it away for good, even if the field is emptied again.
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "Lis" } });
    show("Lis");
    expect(screen.queryByText(enTrips.wizard.step1.movedToNotes)).toBeNull();
    show("");
    expect(screen.queryByText(enTrips.wizard.step1.movedToNotes)).toBeNull();
  });

  it("offers the match to someone with no place in mind", () => {
    field(`${REQUEST} ${REQUEST}`);
    expect(screen.getByRole("link", { name: enTrips.wizard.step1.findMatch }).getAttribute("href")).toBe("/where-should-i-go");
  });

  it("offers neither for a place name", () => {
    field("Lisbon");
    expect(screen.queryByRole("button", { name: enTrips.wizard.step1.keepAsNote })).toBeNull();
    expect(screen.queryByRole("link", { name: enTrips.wizard.step1.findMatch })).toBeNull();
  });

  it("is worded in every language the planner speaks", () => {
    for (const messages of [enTrips, esTrips, itTrips, ptTrips]) {
      for (const key of ["keepAsNote", "findMatch", "movedToNotes"] as const) {
        expect(messages.wizard.step1[key], key).toBeTruthy();
      }
    }
  });
});
