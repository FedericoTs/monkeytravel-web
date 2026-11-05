/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import SeasonalContextCard from "./SeasonalContextCard";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${Object.values(values).join(" ")}` : key),
  useLocale: () => "en",
}));
const sentryException = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/sentry", () => ({ sentryException }));
vi.mock("@/lib/locale", () => ({
  useLocale: () => ({ preferences: { temperatureUnit: "celsius" } }),
  formatTemperatureRange: (min: number, max: number) => `${min}-${max}`,
}));

const weather = {
  weather: {
    icon: "☀️",
    conditions: "Sunny spells",
    temperature: { min: 11, max: 22 },
    precipitation: { rainyDays: 0 },
  },
};
const send = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const props = {
  destination: "Porto, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-12",
  coordinates: { latitude: 41.15, longitude: -8.61 },
};
const waitForWeather = () => act(async () => vi.advanceTimersByTimeAsync(2000));

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset();
  sentryException.mockClear();
  send.mockImplementation(async () => new Response(JSON.stringify(weather)));
  vi.stubGlobal("fetch", send);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the seasonal card", () => {
  it("shows nothing without a place or a start date", () => {
    const noPlace = render(<SeasonalContextCard {...props} destination="" />);
    expect(noPlace.container.textContent).toBe("");
    noPlace.unmount();
    const noDate = render(<SeasonalContextCard {...props} startDate="" />);
    expect(noDate.container.textContent).toBe("");
  });

  it("shows the season for the dates, and follows them", async () => {
    const view = render(<SeasonalContextCard {...props} />);
    await waitForWeather();
    expect(view.container.textContent).toContain("seasons.spring");
    view.rerender(<SeasonalContextCard {...props} startDate="2027-08-10" endDate="2027-08-12" />);
    await waitForWeather();
    expect(view.container.textContent).toContain("seasons.summer");
    expect(view.container.textContent).not.toContain("seasons.spring");
  });

  it("uses the hemisphere of the place", async () => {
    const view = render(<SeasonalContextCard {...props} destination="Queenstown" coordinates={{ latitude: -45, longitude: 168 }} />);
    await waitForWeather();
    expect(view.container.textContent).toContain("seasons.autumn");
  });

  it("asks for the weather once the dates settle, and shows it", async () => {
    render(<SeasonalContextCard {...props} />);
    expect(send).not.toHaveBeenCalled();
    await waitForWeather();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("/api/weather?latitude=41.15&longitude=-8.61&startDate=2027-05-10&endDate=2027-05-12");
    expect(screen.getByText("Sunny spells")).toBeTruthy();
  });

  it("asks for no weather without a whole trip range, and forgets what it had", async () => {
    const view = render(<SeasonalContextCard {...props} />);
    await waitForWeather();
    expect(screen.getByText("Sunny spells")).toBeTruthy();

    view.rerender(<SeasonalContextCard {...props} coordinates={undefined} />);
    await waitForWeather();
    expect(screen.queryByText("Sunny spells")).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sentryException).not.toHaveBeenCalled();
  });

  it("keeps what it shows while a date is being typed", async () => {
    const view = render(<SeasonalContextCard {...props} />);
    await waitForWeather();
    view.rerender(<SeasonalContextCard {...props} startDate="0202-05-10" />);
    await waitForWeather();
    expect(screen.getByText("Sunny spells")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
