import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itTrips from "@/messages/it/trips.json";
import { JourneyRibbon } from "./JourneyRibbon";

/** The ribbon's nights pill read "3 nights" in every language. */
describe("JourneyRibbon", () => {
  it("counts nights in Italian, with the plural", () => {
    render(
      <NextIntlClientProvider locale="it" messages={{ trips: itTrips }}>
        <JourneyRibbon
          stops={[
            { city: "Roma", nights: 3 },
            { city: "Firenze", nights: 1 },
          ]}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByText("3 notti")).toBeTruthy();
    expect(screen.getByText("1 notte")).toBeTruthy();
  });
});
