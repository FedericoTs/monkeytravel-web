/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import TravelAdvisoryBanner from "./TravelAdvisoryBanner";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));

const advisory = (level: string) => ({
  advisory: {
    source: "fcdo",
    sourceCountry: "GB",
    countryName: "Atlantis",
    level,
    summary: "Read the advice before you go.",
    url: "https://example.com/advice",
    updatedAt: "2026-10-01T00:00:00Z",
  },
});
const send = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const settled = () => act(async () => {});

beforeEach(() => {
  send.mockReset();
  vi.stubGlobal("fetch", send);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the travel advisory", () => {
  it("asks for nothing without a country, and shows nothing", async () => {
    const { container } = render(<TravelAdvisoryBanner country="   " />);
    await settled();
    expect(send).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("shows an advisory for the country, with its words", async () => {
    send.mockImplementation(async () => new Response(JSON.stringify(advisory("high"))));
    render(<TravelAdvisoryBanner country=" New Atlantis " />);
    expect(send.mock.calls[0][0]).toBe("/api/advisories/New%20Atlantis");
    await screen.findByText("Read the advice before you go.");
    expect(screen.getByText("level.high")).toBeTruthy();
  });

  it("shows nothing while it asks, at the lowest level, or with no advisory", async () => {
    send.mockImplementation(async () => new Response(JSON.stringify(advisory("low"))));
    const { container, unmount } = render(<TravelAdvisoryBanner country="Atlantis" />);
    expect(container.innerHTML).toBe("");
    await settled();
    expect(container.innerHTML).toBe("");
    unmount();

    send.mockImplementation(async () => new Response(JSON.stringify({ advisory: null })));
    const second = render(<TravelAdvisoryBanner country="Atlantis" />);
    await settled();
    expect(second.container.innerHTML).toBe("");
  });

  it("shows nothing when the route refuses or can't be reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    send.mockImplementation(async () => new Response("{}", { status: 500 }));
    const { container, unmount } = render(<TravelAdvisoryBanner country="Atlantis" />);
    await settled();
    expect(container.innerHTML).toBe("");
    unmount();

    send.mockImplementation(async () => {
      throw new Error("offline");
    });
    const second = render(<TravelAdvisoryBanner country="Atlantis" />);
    await settled();
    expect(second.container.innerHTML).toBe("");
    expect(console.warn).toHaveBeenCalled();
  });
});
