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

function field(destination: string, onKeepAsNote = vi.fn(), extra: Partial<React.ComponentProps<typeof DestinationField>> = {}) {
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
    ...extra,
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
      for (const key of ["title", "fill", "reading", "filled", "capped"] as const) {
        expect(messages.wizard.step1.request[key], key).toBeTruthy();
      }
      expect(messages.wizard.step1.request.capped).toContain("{max}");
    }
  });
});

/**
 * A whole trip typed as a request ("Bali for 8 days with 3 kids") gets one
 * offer to be read into the fields, in place of the warnings a place gets.
 */
describe("a whole trip typed as a request", () => {
  const TRIP = "Bali for 8 days with 3 kids and our friends; somewhere quiet";
  const step1 = enTrips.wizard.step1;

  it("offers to fill step 1 in from it, or to keep it for the next step", () => {
    const onReadRequest = vi.fn(async () => "filled" as const);
    const { onKeepAsNote } = field(TRIP, vi.fn(), { requestLike: true, onReadRequest });
    fireEvent.click(screen.getByRole("button", { name: step1.request.fill }));
    expect(onReadRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: step1.keepAsNote }));
    expect(onKeepAsNote).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: step1.findMatch })).toBeTruthy();
    // Not the red warnings meant for a place's name.
    expect(screen.queryByText(step1.destinationInvalidChars)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the words were kept when no place could be read from them", async () => {
    const { show } = field(TRIP, vi.fn(), { requestLike: true, onReadRequest: async () => "kept" as const });
    fireEvent.click(screen.getByRole("button", { name: step1.request.fill }));
    await vi.waitFor(() => {
      show("");
      expect(screen.getByText(step1.movedToNotes)).toBeTruthy();
    });
  });

  it("shows it is reading, and takes no second press meanwhile", () => {
    field(TRIP, vi.fn(), { requestLike: true, readingRequest: true, onReadRequest: vi.fn() });
    const button = screen.getByRole("button", { name: step1.request.reading });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: step1.keepAsNote }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps the warnings for a place's name, and offers nothing for a sentence read as a trip", () => {
    field("Lisbon;", vi.fn(), { requestLike: false, onReadRequest: vi.fn() });
    expect(screen.queryByRole("button", { name: step1.request.fill })).toBeNull();
    expect(screen.getByText(step1.destinationInvalidChars)).toBeTruthy();
    cleanup();
    const expressTrip = { destination: "Lisbon", days: 5, month: 3, vibes: [], intent: null, budget: null };
    field("5 days in Lisbon in March", vi.fn(), { requestLike: true, onReadRequest: vi.fn(), expressTrip });
    expect(screen.queryByRole("button", { name: step1.request.fill })).toBeNull();
  });
});
