import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, SetStateAction } from "react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import { MultiCityRoute, MultiCityToggle } from "./MultiCityControls";

type RouteProps = ComponentProps<typeof MultiCityRoute>;
const setMultiCityMode = vi.fn();
const setCityRows = vi.fn();
const route = (over: Partial<RouteProps> = {}) =>
  render(
    <MultiCityRoute
      multiCityMode={false}
      setMultiCityMode={setMultiCityMode}
      startDate="2027-06-01"
      endDate="2027-06-12"
      cityRows={[
        { city: "Lisbon", nights: 3 },
        { city: "Porto", nights: 2 },
      ]}
      setCityRows={setCityRows}
      {...over}
    />
  );

beforeEach(() => [setMultiCityMode, setCityRows].forEach((fn) => fn.mockClear()));
afterEach(cleanup);

describe("MultiCityRoute", () => {
  it("offers a 12-day single-city trip a split into cities", () => {
    route();
    const nudge = screen.getByRole("button", { name: 'wizard.multiCity.longTripNudge {"days":12}' });
    fireEvent.click(nudge);
    expect(setMultiCityMode).toHaveBeenCalledWith(true);
    expect(screen.queryByText("wizard.multiCity.routeLabel")).toBeNull();
  });

  it("says nothing on a shorter trip, or before the dates are in", () => {
    route({ endDate: "2027-06-11" });
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();

    route({ startDate: "", endDate: "" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the route builder, and no offer, while multi-city is on", () => {
    route({ multiCityMode: true });
    expect(screen.getByText("wizard.multiCity.routeLabel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /longTripNudge/ })).toBeNull();
  });
});

describe("MultiCityToggle", () => {
  it("shows the mode and flips it", () => {
    render(<MultiCityToggle multiCityMode={false} setMultiCityMode={setMultiCityMode} />);
    const toggle = screen.getByRole("switch", { name: "wizard.multiCity.toggleAria" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    const flip = setMultiCityMode.mock.calls[0][0] as SetStateAction<boolean>;
    expect(typeof flip === "function" && flip(false)).toBe(true);
    cleanup();

    render(<MultiCityToggle multiCityMode setMultiCityMode={setMultiCityMode} />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });
});
