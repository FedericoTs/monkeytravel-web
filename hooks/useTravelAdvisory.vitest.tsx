/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { coversWholeCountry, useTravelAdvisory } from "./useTravelAdvisory";

const answer = (level: string) => ({
  advisory: {
    source: "fcdo",
    sourceCountry: "GB",
    countryName: "Atlantis",
    level,
    advice: level === "low" ? null : "essential_parts",
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

describe("the UK's travel advice for a trip", () => {
  it("asks for nothing without a destination", async () => {
    const { result } = renderHook(() => useTravelAdvisory("   "));
    await settled();
    expect(send).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("sends the country only: the part after the last comma", async () => {
    send.mockImplementation(async () => new Response(JSON.stringify(answer("advisory"))));
    renderHook(() => useTravelAdvisory("Port Royal, New Atlantis"));
    await settled();
    expect(send.mock.calls[0][0]).toBe("/api/advisories/New%20Atlantis");
  });

  it("gives the advice once it arrives, and nothing before", async () => {
    send.mockImplementation(async () => new Response(JSON.stringify(answer("high"))));
    const { result } = renderHook(() => useTravelAdvisory("Atlantis"));
    expect(result.current).toBeNull();
    await settled();
    expect(result.current).toMatchObject({ level: "high", advice: "essential_parts" });
  });

  it("gives nothing at the lowest level, or with no advisory", async () => {
    send.mockImplementation(async () => new Response(JSON.stringify(answer("low"))));
    const low = renderHook(() => useTravelAdvisory("Atlantis"));
    await settled();
    expect(low.result.current).toBeNull();

    send.mockImplementation(async () => new Response(JSON.stringify({ advisory: null })));
    const none = renderHook(() => useTravelAdvisory("Atlantis"));
    await settled();
    expect(none.result.current).toBeNull();
  });

  it("gives nothing when the route refuses or can't be reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    send.mockImplementation(async () => new Response("{}", { status: 500 }));
    const refused = renderHook(() => useTravelAdvisory("Atlantis"));
    await settled();
    expect(refused.result.current).toBeNull();

    send.mockImplementation(async () => {
      throw new Error("offline");
    });
    const offline = renderHook(() => useTravelAdvisory("Atlantis"));
    await settled();
    expect(offline.result.current).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("advice that covers the whole country", () => {
  const advisory = (advice: string | null) =>
    ({ ...answer("high").advisory, advice }) as unknown as Parameters<typeof coversWholeCountry>[0];

  it.each(["all_whole", "essential_whole"])("is %s", (advice) => {
    expect(coversWholeCountry(advisory(advice))).toBe(true);
  });

  it.each(["all_parts", "essential_parts", "other", null])("is not %s", (advice) => {
    expect(coversWholeCountry(advisory(advice))).toBe(false);
  });

  it("is not missing advice", () => {
    expect(coversWholeCountry(null)).toBe(false);
  });
});
