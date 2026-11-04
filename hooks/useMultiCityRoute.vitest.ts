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
});
