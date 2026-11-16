/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ItineraryDay } from "@/types";
import type { TripAssistantChange } from "@/lib/ai/assistant/pending-change";

/**
 * A turn prepares a change; the panel shows it, and Apply saves it. The undo
 * that follows says what changed and puts back what the change moved: the trip's
 * end date, and only while the trip is as the change left it.
 */

vi.mock("next-intl", () => ({
  // Echoes the key and its values, so a test sees which text and with what.
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  useLocale: () => "en",
}));
vi.mock("@/lib/locale", () => ({ useLocale: () => ({ preferences: { preferredCurrency: "EUR" }, exchangeRates: null }) }));
vi.mock("@/lib/analytics", () => ({ trackAIAssistantMessage: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({ captureAIAssistantUsed: vi.fn(async () => {}) }));

Element.prototype.scrollIntoView = vi.fn();

import AIAssistantEnhanced from "./AIAssistantEnhanced";

const act = { id: "a1", name: "Trinity College", type: "attraction" };
const days = [
  { day_number: 1, date: "2027-03-11", activities: [act] },
  { day_number: 2, date: "2027-03-12", activities: [{ ...act, id: "b1", name: "National Gallery" }] },
] as ItineraryDay[];

/** Answers the panel's calls; `applied` is what /apply says it did. */
function serve(pendingChange: TripAssistantChange, applied: Record<string, unknown>) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response(JSON.stringify({ conversations: [] }));
      const body = JSON.parse(String(init.body));
      posts.push({ url: String(url), body });
      if (url === "/api/ai/assistant/apply") return new Response(JSON.stringify({ success: true, itineraryVersion: 9, action: applied }));
      if (url === "/api/ai/assistant/undo") return new Response(JSON.stringify({ success: true, restoredItinerary: days }));
      return new Response(
        JSON.stringify({
          conversationId: "conv-1",
          message: { role: "assistant", content: "Ready.", action: { type: pendingChange.type, applied: false, pending: true }, timestamp: "2027-01-01T00:00:00Z" },
          pendingChange,
          usage: { remaining: 9, limit: 10, tier: "free", resetAt: "2027-01-02T00:00:00Z" },
        })
      );
    })
  );
  return posts;
}

async function applyChange() {
  render(<AIAssistantEnhanced tripId="trip-1" tripTitle="Dublin" itinerary={days} isOpen onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("placeholder"), { target: { value: "Add a day in Howth" } });
  fireEvent.submit(screen.getByPlaceholderText("placeholder").closest("form") as HTMLFormElement);
  fireEvent.click(await screen.findByRole("button", { name: /applyChange/ }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a change a turn prepared", () => {
  it("is applied with the days it holds, and its undo counts them and puts the end date back", async () => {
    const revised = [days[1], { day_number: 3, date: "2027-03-13", activities: [act] }] as ItineraryDay[];
    const posts = serve(
      { type: "apply_draft", days: revised, changedDayNumbers: [2, 3], newEndDate: "2027-03-13", previousEndDate: "2027-03-12" },
      { type: "apply_draft", dayNumber: 2 }
    );
    await applyChange();

    const undo = await screen.findByRole("button", { name: /undoButton/ });
    const apply = posts.find((p) => p.url === "/api/ai/assistant/apply");
    expect(apply?.body).toMatchObject({ tripId: "trip-1", conversationId: "conv-1", changeType: "apply_draft", dayNumber: 2 });
    expect((apply?.body.days as ItineraryDay[]).map((d) => d.day_number)).toEqual([2, 3]);

    fireEvent.click(undo);
    expect(await screen.findByText(/undoActions\.updatedDays .*count.*2/)).toBeTruthy();
    expect(posts.find((p) => p.url === "/api/ai/assistant/undo")?.body).toMatchObject({
      tripId: "trip-1",
      previousEndDate: "2027-03-12",
      expectedVersion: 9,
    });
  });

  it("names a new day by its theme and the number the server gave it, not the one it was proposed with", async () => {
    const day = { day_number: 3, date: "2027-03-13", theme: "Howth", activities: [act] } as ItineraryDay;
    const posts = serve({ type: "add_day", day, dayNumber: 3, previousEndDate: "2027-03-12" }, { type: "add_day", dayNumber: 4 });
    await applyChange();

    expect(await screen.findByText(/^Howth .*number.*4/)).toBeTruthy();
    expect(posts.find((p) => p.url === "/api/ai/assistant/apply")?.body).toMatchObject({ changeType: "add_day", dayNumber: 3 });

    fireEvent.click(screen.getByRole("button", { name: /undoButton/ }));
    expect(await screen.findByText(/undoActions\.addedDay .*number.*4/)).toBeTruthy();
    expect(posts.find((p) => p.url === "/api/ai/assistant/undo")?.body).toMatchObject({ previousEndDate: "2027-03-12" });
  });
});

describe("a reply that read new trip dates from the ask", () => {
  /** The panel's calls, with a reply that carries `changeDates` and nothing to apply. */
  function serveDates() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") return new Response(JSON.stringify({ conversations: [] }));
        return new Response(
          JSON.stringify({
            conversationId: "conv-1",
            message: {
              role: "assistant",
              content: "Your trip is 11 to 12 March.",
              changeDates: { start: "2027-03-11", end: "2027-03-14" },
              timestamp: "2027-01-01T00:00:00Z",
            },
            pendingChange: null,
            usage: { remaining: 9, limit: 10, tier: "free", resetAt: "2027-01-02T00:00:00Z" },
          })
        );
      })
    );
  }
  async function ask(onChangeDates?: (start: string, end: string) => void) {
    render(<AIAssistantEnhanced tripId="trip-1" tripTitle="Dublin" itinerary={days} isOpen onClose={() => {}} onChangeDates={onChangeDates} />);
    fireEvent.change(screen.getByPlaceholderText("placeholder"), { target: { value: "we stay until 14 March" } });
    fireEvent.submit(screen.getByPlaceholderText("placeholder").closest("form") as HTMLFormElement);
    await screen.findByText("Your trip is 11 to 12 March.");
  }

  it("offers Change dates on those dates under the reply", async () => {
    serveDates();
    const onChangeDates = vi.fn();
    await ask(onChangeDates);
    fireEvent.click(screen.getByRole("button", { name: /changeDatesTo/ }));
    expect(onChangeDates).toHaveBeenCalledWith("2027-03-11", "2027-03-14");
  });

  it("offers nothing where the trip's dates can't be changed", async () => {
    serveDates();
    await ask();
    expect(screen.queryByRole("button", { name: /changeDatesTo/ })).toBeNull();
  });
});
