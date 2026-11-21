import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import type { PlacePrediction } from "@/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { number?: number }) => (values?.number ? `${key} ${values.number}` : key),
  useLocale: () => "en",
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
// Search on every keystroke: the 300 ms debounce is not what's under test.
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(v: T) => v }));

import { MultiCityRouteBuilder, type RouteStop } from "./MultiCityRouteBuilder";

const porto: PlacePrediction = {
  placeId: "porto-pt",
  mainText: "Porto",
  secondaryText: "Portugal",
  fullText: "Porto, Portugal",
  countryCode: "PT",
  flag: "",
  types: ["(cities)"],
  source: "local",
};

beforeEach(() => {
  // jsdom has no scrollIntoView; the field keeps the highlighted row in view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ json: async () => ({ predictions: url.includes("/popular") ? [] : [porto] }) }))
  );
});
afterEach(() => vi.unstubAllGlobals());

// Each city of a route was a plain text box: what was typed, slips and all, went on the day headings and on the
// cards between cities.
describe("a route's rows", () => {
  it("find each city as the destination box does, and keep the place's own name", async () => {
    const seen: RouteStop[][] = [];
    function Harness() {
      const [rows, setRows] = useState<RouteStop[]>([
        { city: "Lisbon", nights: 2 },
        { city: "", nights: 3 },
      ]);
      return (
        <MultiCityRouteBuilder
          rows={rows}
          onChange={(next) => {
            seen.push(next);
            setRows(next);
          }}
        />
      );
    }
    render(<Harness />);
    const second = screen.getByRole("combobox", { name: "wizard.multiCity.cityPlaceholder 2" });
    act(() => second.focus());
    fireEvent.change(second, { target: { value: "Prt" } });
    fireEvent.click(await screen.findByRole("option", { name: /^Porto\s*Portugal$/ }));
    expect(seen.at(-1)).toEqual([
      { city: "Lisbon", nights: 2 },
      { city: "Porto", nights: 3 },
    ]);
    expect((second as HTMLInputElement).value).toBe("Porto");
    // The nights stay number fields, one a city.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
  });

  it("keep a city typed by hand when nothing is picked", () => {
    const seen: RouteStop[][] = [];
    render(<MultiCityRouteBuilder rows={[{ city: "", nights: 2 }, { city: "", nights: 2 }]} onChange={(next) => seen.push(next)} />);
    fireEvent.change(screen.getByRole("combobox", { name: "wizard.multiCity.cityPlaceholder 1" }), { target: { value: "Faro" } });
    expect(seen.at(-1)).toEqual([
      { city: "Faro", nights: 2 },
      { city: "", nights: 2 },
    ]);
  });
});
