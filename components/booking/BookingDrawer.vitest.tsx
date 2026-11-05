/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BookingDrawer from "./BookingDrawer";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));
vi.mock("@/lib/native/external-link", () => ({ openExternal: vi.fn() }));

const show = () =>
  render(<BookingDrawer isOpen onClose={() => {}} destination="Porto" startDate="2027-05-10" endDate="2027-05-12" travelers={2} tripId="trip-1" />);
const field = () => screen.getByPlaceholderText("enterCityOrAirport") as HTMLInputElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const suggestion = (city: string) => screen.queryByRole("button", { name: new RegExp(`^${city}`) });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the flight drawer's cities", () => {
  it("suggests nothing for a letter", () => {
    show();
    type("L");
    expect(suggestion("London")).toBeNull();
  });

  it("suggests cities from two letters on, whatever the case", () => {
    show();
    type("lon");
    expect(suggestion("London")).not.toBeNull();
  });

  it("suggests at most five", () => {
    show();
    type("an");
    const cities = screen.getAllByRole("button").filter((b) => /^[A-Z][a-z].*[A-Z]{3}$/.test(b.textContent ?? ""));
    expect(cities.length).toBeLessThanOrEqual(5);
    expect(cities.length).toBeGreaterThan(0);
  });

  it("closes the list on the city picked, and opens it again on typing", () => {
    show();
    type("lon");
    fireEvent.click(suggestion("London")!);
    expect(field().value).toBe("London");
    expect(suggestion("London")).toBeNull();

    type("Londo");
    expect(suggestion("London")).not.toBeNull();
  });
});
