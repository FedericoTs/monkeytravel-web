import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * The trip page's assistant: a request to see prices in another currency is
 * answered by the page switching the viewer's currency, as the planner does.
 */

const setPreferredCurrency = vi.fn();
vi.mock("@/lib/locale", () => ({
  useLocale: () => ({ preferences: { preferredCurrency: "USD" }, exchangeRates: null, setPreferredCurrency }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/analytics", () => ({ trackAIAssistantMessage: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({ captureAIAssistantUsed: vi.fn() }));

import { useTripAssistant } from "./useTripAssistant";

const reply = (extra: Record<string, unknown>) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      message: { role: "assistant", content: "Done: prices now show in EUR.", timestamp: "2026-11-12T16:00:00Z" },
      conversationId: "conv-1",
      pendingChange: null,
      usage: { remaining: 9 },
      ...extra,
    }),
  }));

afterEach(() => {
  vi.unstubAllGlobals();
  setPreferredCurrency.mockReset();
});

describe("useTripAssistant", () => {
  it("switches the page to the currency a reply carries", async () => {
    vi.stubGlobal("fetch", reply({ currency: "EUR" }));
    const { result } = renderHook(() => useTripAssistant({ tripId: "trip-1", itinerary: [], isOpen: false }));
    await act(async () => {
      await result.current.sendMessage("show the costs in euros");
    });
    expect(setPreferredCurrency).toHaveBeenCalledWith("EUR");
    expect(result.current.messages.at(-1)?.content).toBe("Done: prices now show in EUR.");
  });

  it("leaves the currency alone on any other reply", async () => {
    vi.stubGlobal("fetch", reply({}));
    const { result } = renderHook(() => useTripAssistant({ tripId: "trip-1", itinerary: [], isOpen: false }));
    await act(async () => {
      await result.current.sendMessage("how much is day 2?");
    });
    expect(setPreferredCurrency).not.toHaveBeenCalled();
  });
});
