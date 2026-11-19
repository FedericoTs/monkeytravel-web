import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, renderHook } from "@testing-library/react";
import { useMultiCityRoute } from "./useMultiCityRoute";

type Props = Parameters<typeof useMultiCityRoute>[0];
const route = (over: Partial<Props> = {}) => {
  const props: Props = {
    enabled: true,
    deepLinked: false,
    linkedCity: null,
    startDate: "2027-05-10",
    setDestination: vi.fn(),
    setEndDate: vi.fn(),
    ...over,
  };
  return { props, hook: renderHook((p: Props) => useMultiCityRoute(p), { initialProps: props }) };
};

describe("useMultiCityRoute", () => {
  it("starts as a single city with a two-city route to fill", () => {
    const { props, hook } = route();
    expect(hook.result.current.multiCityMode).toBe(false);
    expect(hook.result.current.cityRows).toEqual([
      { city: "", nights: 3 },
      { city: "", nights: 2 },
    ]);
    expect(props.setDestination).not.toHaveBeenCalled();
  });

  it("arrives from ?multi=1 with the linked city as the first leg", () => {
    const { hook } = route({ deepLinked: true, linkedCity: "Rome" });
    expect(hook.result.current.multiCityMode).toBe(true);
    expect(hook.result.current.cityRows[0]).toEqual({ city: "Rome", nights: 3 });
  });

  // The server renders without running effects: what it shows is the first state.
  it("renders a ?multi=1 arrival as the route, before any effect runs", () => {
    function Probe(p: Props) {
      const r = useMultiCityRoute(p);
      return createElement("span", null, `${r.multiCityMode}|${r.cityRows[0].city}`);
    }
    const props = { enabled: true, linkedCity: "Rome", startDate: "", setDestination: vi.fn(), setEndDate: vi.fn() };
    expect(renderToString(createElement(Probe, { ...props, deepLinked: true }))).toContain("true|Rome");
    expect(renderToString(createElement(Probe, { ...props, deepLinked: false }))).toContain("false|");
    expect(renderToString(createElement(Probe, { ...props, deepLinked: true, enabled: false }))).toContain("false|");
  });

  it("ignores the link while multi-city is switched off", () => {
    const { hook } = route({ enabled: false, deepLinked: true, linkedCity: "Rome" });
    expect(hook.result.current.multiCityMode).toBe(false);
    expect(hook.result.current.cityRows[0].city).toBe("");
  });

  it("mirrors the route into the destination and the end date", () => {
    const { props, hook } = route();
    act(() => {
      hook.result.current.setMultiCityMode(true);
      hook.result.current.setCityRows([
        { city: " Rome ", nights: 3 },
        { city: "Florence", nights: 2 },
        { city: "", nights: 4 },
        { city: "Siena", nights: 0 },
      ]);
    });
    // Only legs count: a row without a city or without nights is not one yet.
    expect(props.setDestination).toHaveBeenLastCalledWith("Rome & Florence");
    expect(props.setEndDate).toHaveBeenLastCalledWith("2027-05-14");
  });

  it("leaves the end date alone without a start date or nights", () => {
    const { props, hook } = route({ startDate: "" });
    act(() => {
      hook.result.current.setMultiCityMode(true);
      hook.result.current.setCityRows([{ city: "Rome", nights: 3 }]);
    });
    expect(props.setDestination).toHaveBeenLastCalledWith("Rome");
    expect(props.setEndDate).not.toHaveBeenCalled();
  });

  it("goes back to a single city and a new route", () => {
    const { hook } = route({ deepLinked: true, linkedCity: "Rome" });
    act(() => hook.result.current.resetRoute());
    expect(hook.result.current.multiCityMode).toBe(false);
    expect(hook.result.current.cityRows).toEqual([
      { city: "", nights: 3 },
      { city: "", nights: 2 },
    ]);
  });

  const thailand = [
    { city: "Bangkok", nights: 3 },
    { city: "Chiang Mai", nights: 4 },
    { city: "Phuket", nights: 7 },
  ];

  it("takes an offered route: its cities planned in order, the place it stands for kept", () => {
    const { props, hook } = route();
    act(() => hook.result.current.takeRoute(thailand, "Thailand"));
    expect(hook.result.current.multiCityMode).toBe(true);
    expect(hook.result.current.cityRows).toEqual(thailand);
    expect(hook.result.current.routeFrom).toBe("Thailand");
    expect(props.setDestination).toHaveBeenLastCalledWith("Bangkok, Chiang Mai & Phuket");
    expect(props.setEndDate).toHaveBeenLastCalledWith("2027-05-23");
  });

  it("gives the typed place back when the offered route is switched off", () => {
    const { props, hook } = route();
    act(() => hook.result.current.takeRoute(thailand, "Thailand"));
    act(() => hook.result.current.switchMultiCity((on) => !on));
    expect(hook.result.current.multiCityMode).toBe(false);
    expect(props.setDestination).toHaveBeenLastCalledWith("Thailand");
    expect(hook.result.current.routeFrom).toBeNull();
    // Switched on and off again, the route no longer stands for a typed place.
    act(() => hook.result.current.switchMultiCity(true));
    act(() => hook.result.current.switchMultiCity(false));
    expect(props.setDestination).not.toHaveBeenLastCalledWith("Thailand");
  });

  it("forgets the typed place, without putting it back, when the page turns the route off for another trip", () => {
    const { props, hook } = route();
    act(() => hook.result.current.takeRoute(thailand, "Thailand"));
    act(() => hook.result.current.setMultiCityMode(false));
    expect(hook.result.current.multiCityMode).toBe(false);
    expect(hook.result.current.routeFrom).toBeNull();
    expect(props.setDestination).not.toHaveBeenLastCalledWith("Thailand");
    act(() => hook.result.current.switchMultiCity(true));
    act(() => hook.result.current.switchMultiCity(false));
    expect(props.setDestination).not.toHaveBeenLastCalledWith("Thailand");
  });

  it("switches like a plain setter when no route was offered", () => {
    const { hook } = route();
    act(() => hook.result.current.switchMultiCity((on) => !on));
    expect(hook.result.current.multiCityMode).toBe(true);
    act(() => hook.result.current.setMultiCityMode((on) => !on));
    expect(hook.result.current.multiCityMode).toBe(false);
  });

  it("forgets the typed place on Start Over", () => {
    const { props, hook } = route();
    act(() => hook.result.current.takeRoute(thailand, "Thailand"));
    act(() => hook.result.current.resetRoute());
    expect(hook.result.current.routeFrom).toBeNull();
    expect(props.setDestination).not.toHaveBeenLastCalledWith("Thailand");
  });
});
