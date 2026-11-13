/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { formatDateRange } from "@/lib/datetime";
import type { AssistantMessage } from "./thread";
import { askedTripDates, offerTripDates, readTripDates } from "./trip-dates";

/** A trip from 28 Nov to 6 Dec 2026. */
const trip = { startDate: "2026-11-28", endDate: "2026-12-06" };
const span = (start: string, end: string) => ({ start, end });

describe("the dates a traveller gives for the whole trip", () => {
  it.each([
    ["28 nov we arrive at 10 pm and go back 8 dec our flight is 6pm", "en, short months"],
    ["We arrive November 28th and fly home December 8th", "en, month first"],
    ["from the 28th of November to the 8th of December", "en, of"],
    ["Nov 28 to Dec 8 please", "en, short month first"],
    ["del 28 de noviembre al 8 de diciembre", "es"],
    ["llegamos el 28 nov y volvemos el 8 dic", "es, short months"],
    ["dal 28 novembre all'8 dicembre", "it"],
    ["arriviamo il 28 nov, ripartiamo l'8 dic", "it, short months"],
    ["de 28 de novembro a 8 de dezembro", "pt"],
    ["chegamos dia 28/11 e voltamos dia 8/12", "pt, numbers"],
    ["28/11 - 8/12", "numbers, day first"],
    ["28.11.2026 - 08.12.2026", "numbers with dots, which need a year"],
    ["11/28 to 12/8", "numbers, month first"],
  ])("%s (%s)", (message) => {
    expect(readTripDates(message, trip)).toEqual(span("2026-11-28", "2026-12-08"));
  });

  it("moves the whole trip when both ends change", () => {
    expect(readTripDates("change my dates to 3 dec - 12 dec", trip)).toEqual(span("2026-12-03", "2026-12-12"));
  });

  it("crosses into the next year", () => {
    expect(readTripDates("28 dec to 3 jan", { startDate: "2026-12-28" })).toEqual(
      span("2026-12-28", "2027-01-03"),
    );
  });

  it("takes the year nearest the trip", () => {
    expect(readTripDates("2 feb - 9 feb", { startDate: "2027-01-30" })).toEqual(
      span("2027-02-02", "2027-02-09"),
    );
  });

  it.each([
    ["we go back 8 dec now", "en"],
    ["until December 8", "en, until"],
    ["hasta el 8 de diciembre", "es"],
    ["fino all'8 dicembre", "it"],
    ["até 8 de dezembro", "pt"],
  ])("reads a new last day on its own: %s (%s)", (message) => {
    expect(readTripDates(message, trip)).toEqual(span("2026-11-28", "2026-12-08"));
  });

  it.each([
    ["add a museum on 3 dec", "one date, not a last day"],
    ["day 3 at 10.30, and a 1.5 hour walk", "times and durations"],
    ["make day 3 about whale watching", "no date"],
    ["28/11, 1/12 and 8/12", "three dates"],
    ["8 dec to 28 nov", "an end before the start"],
    ["1 jan to 30 jun", "longer than any trip"],
    ["it costs 28.50 and the walk is 12-15 km", "prices and distances"],
  ])("reads nothing from %s (%s)", (message) => {
    expect(readTripDates(message, trip)).toBeNull();
  });
});

describe("new dates for the trip, in an ask about them", () => {
  const span = { start: "2026-11-28", end: "2026-12-06" };

  type Ask = { message: string; previous?: string; why: string };

  it.each<Ask & { end: string }>([
    { message: "28 nov we arrive at 10 pm and go back 8 dec our flight is 6pm", end: "2026-12-08", why: "en" },
    { message: "llegamos el 28 nov y volvemos el 8 dic", end: "2026-12-08", why: "es" },
    { message: "arriviamo il 28 nov, ripartiamo l'8 dic", end: "2026-12-08", why: "it" },
    { message: "chegamos dia 28/11 e voltamos dia 8/12", end: "2026-12-08", why: "pt" },
    { message: "we stay until 3 dec now", end: "2026-12-03", why: "three days shorter" },
    { message: "28 nov - 10 dec", previous: "can you change our dates?", end: "2026-12-10", why: "the ask before says what they are" },
  ])("reads $message ($why)", ({ message, previous, end }) => {
    expect(askedTripDates(message, previous, span)).toEqual({ start: "2026-11-28", end });
  });

  it.each<Ask>([
    { message: "the Louvre on 28 nov and the Orsay on 8 dec", why: "no word about the dates" },
    { message: "we land on 28 nov, so the Louvre on 30 nov", why: "some days of the trip" },
    { message: "we stay until 2 dec now", why: "four days shorter: some of its days" },
    { message: "we arrive 28 nov and fly home 6 dec", why: "the trip's own dates" },
    { message: "28 nov - 10 dec", previous: "add a museum", why: "no word in this ask or the one before" },
  ])("reads nothing from $message ($why)", ({ message, previous }) => {
    expect(askedTripDates(message, previous, span)).toBeNull();
  });
});

describe("the reply's offer of Change dates", () => {
  const reply = { role: "assistant", content: "Your trip runs 28 November to 6 December.", timestamp: "2026-11-13T00:00:00Z" } as AssistantMessage;
  const asked = { start: "2026-11-28", end: "2026-12-08" };
  const span = { start: "2026-11-28", end: "2026-12-06" };

  it("says the dates stand until the button, and carries the asked ones", () => {
    const offered = offerTripDates(reply, asked, span, "en");
    expect(offered.changeDates).toEqual(asked);
    expect(offered.content).toBe(
      `Your trip runs 28 November to 6 December.\n\n(Your trip's dates are still ${formatDateRange(span.start, span.end, "en")}: to change them to ${formatDateRange(asked.start, asked.end, "en")}, tap the button below.)`,
    );
  });

  it("speaks the traveller's language", () => {
    expect(offerTripDates(reply, asked, span, "es").content).toContain("toca el botón de abajo");
  });

  it("leaves a reply without new dates as it is", () => {
    expect(offerTripDates(reply, null, span, "en")).toBe(reply);
  });
});
