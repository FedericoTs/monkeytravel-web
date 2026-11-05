/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ItineraryDay } from "@/types";
import { ItineraryWriteBlockedError } from "@/lib/trips/itinerary-sync";

/**
 * The trip assistant's conversation, through the panel: what is asked, what comes
 * back, a proposal's three ways on (apply, another try, cancel) and its undo.
 */

const usedEvents = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("next-intl", () => ({
  // Echoes the key and its values, so a test sees which text and with what.
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock("@/lib/locale", () => ({ useLocale: () => ({ preferences: { preferredCurrency: "EUR" }, exchangeRates: {} }) }));
vi.mock("@/lib/analytics", () => ({ trackAIAssistantMessage: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({ captureAIAssistantUsed: usedEvents }));

Element.prototype.scrollIntoView = vi.fn();

import AIAssistantEnhanced from "./AIAssistantEnhanced";

const activity = { id: "a1", name: "Trinity College", type: "attraction" };
const days = [{ day_number: 1, date: "2027-03-11", activities: [activity] }] as ItineraryDay[];
const proposal = {
  type: "apply_draft",
  days: [{ day_number: 1, date: "2027-03-11", activities: [{ ...activity, name: "Howth" }] }],
  changedDayNumbers: [1],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const reply = (content: string, extra: Record<string, unknown> = {}) => ({
  conversationId: "conv-1",
  message: { role: "assistant", content, timestamp: "2027-01-01T00:00:00Z" },
  usage: { remaining: 9 },
  model: "m",
  ...extra,
});
const proposing = () => reply("Ready.", { pendingChange: proposal, message: { role: "assistant", content: "Ready.", timestamp: "t", action: { type: "apply_draft", applied: true } } });

type Answers = Partial<Record<"history" | "chat" | "apply" | "undo", (body: Record<string, unknown>) => Response>>;

/** Answers the panel's calls by route; returns what was posted to each. */
function serve(answers: Answers) {
  const posted: Record<"chat" | "apply" | "undo", Array<Record<string, unknown>>> = { chat: [], apply: [], undo: [] };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return answers.history?.({}) ?? json({ conversations: [] });
    const body = JSON.parse(String(init.body));
    const route = url === "/api/ai/assistant/apply" ? "apply" : url === "/api/ai/assistant/undo" ? "undo" : "chat";
    posted[route].push(body);
    return answers[route]?.(body) ?? json({ success: true, itineraryVersion: 8, action: { dayNumber: 1 } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posted, fetchMock };
}

function open(props: Partial<Parameters<typeof AIAssistantEnhanced>[0]> = {}) {
  return render(<AIAssistantEnhanced tripId="trip-1" tripTitle="Dublin" itinerary={days} isOpen onClose={() => {}} {...props} />);
}
const box = () => screen.getByPlaceholderText("placeholder") as HTMLTextAreaElement;
function send(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.submit(box().closest("form") as HTMLFormElement);
}
const applyButton = () => screen.findByRole("button", { name: /applyChange/ });
/** The card's three actions: Apply, another try, cancel. */
const cardButtons = async () => Array.from((await applyButton()).parentElement!.querySelectorAll("button"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  usedEvents.mockClear();
});

describe("opening the panel", () => {
  it("brings back the latest conversation, and asks nothing while closed", async () => {
    const { fetchMock } = serve({
      history: () => json({ conversations: [{ id: "conv-9", messages: [{ role: "assistant", content: "Welcome back.", timestamp: "t" }] }] }),
      chat: () => json(reply("Sure.")),
    });
    const { rerender } = open({ isOpen: false });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<AIAssistantEnhanced tripId="trip-1" tripTitle="Dublin" itinerary={days} isOpen onClose={() => {}} />);
    expect(await screen.findByText("Welcome back.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/ai/assistant?tripId=trip-1");
  });

  it("carries on the conversation it brought back", async () => {
    const { posted } = serve({
      history: () => json({ conversations: [{ id: "conv-9", messages: [] }] }),
      chat: () => json(reply("Sure.")),
    });
    open();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    send("Is it open on Monday?");
    await screen.findByText("Sure.");
    expect(posted.chat[0]).toMatchObject({ conversationId: "conv-9" });
  });

  it("stays usable when the history can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? json(reply("Sure.")) : Promise.reject(new TypeError("Load failed")))));
    open();
    send("Hello");
    expect(await screen.findByText("Sure.")).toBeTruthy();
  });
});

describe("asking", () => {
  it("sends the question with the trip, clears the box, and shows the answer and what's left", async () => {
    const { posted } = serve({ chat: () => json(reply("It opens at nine.")) });
    open();
    send("  When does it open?  ");
    expect(box().value).toBe("");
    expect(await screen.findByText("It opens at nine.")).toBeTruthy();
    expect(screen.getByText(/requestsLeft .*9/)).toBeTruthy();
    expect(posted.chat[0]).toMatchObject({ tripId: "trip-1", message: "When does it open?", conversationId: null, itinerary: days });
  });

  it("sends nothing for an empty box", async () => {
    const { posted } = serve({});
    open();
    send("   ");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.chat).toEqual([]);
  });

  it("keeps the conversation's id for the next question", async () => {
    const { posted } = serve({ chat: () => json(reply("Yes.")) });
    open();
    send("One");
    await screen.findByText("Yes.");
    send("Two");
    await waitFor(() => expect(posted.chat).toHaveLength(2));
    expect(posted.chat[1]).toMatchObject({ conversationId: "conv-1" });
  });

  it("counts a plain answer as used, and a proposal only once it is applied", async () => {
    serve({ chat: () => json(reply("Yes.")) });
    open();
    send("One");
    await screen.findByText("Yes.");
    expect(usedEvents).toHaveBeenCalledTimes(1);
    expect(usedEvents).toHaveBeenCalledWith(expect.objectContaining({ trip_id: "trip-1", message_length: 3, surface: "trip_detail", action_applied: false }));

    cleanup();
    usedEvents.mockClear();
    serve({ chat: () => json(proposing()) });
    open();
    send("Change it");
    const apply = await applyButton();
    expect(usedEvents).not.toHaveBeenCalled();
    fireEvent.click(apply);
    await waitFor(() => expect(usedEvents).toHaveBeenCalledTimes(1));
    expect(usedEvents).toHaveBeenCalledWith(expect.objectContaining({ action_applied: true, action_type: "apply_draft" }));
  });

  it("failing takes the question back and says why, in the catalog's words", async () => {
    serve({ chat: () => json({ code: "OUTDATED" }, 409) });
    open();
    send("Change it");
    expect(await screen.findByText("errors.outdated")).toBeTruthy();
    expect(screen.queryByText("Change it", { selector: "p" })).toBeNull();
  });

  it("failing puts the question back in the box, to send again", async () => {
    const { posted } = serve({ chat: () => json({ error: "Internal server error" }, 500) });
    open();
    send("  Change it  ");
    expect(await screen.findByText("error")).toBeTruthy();
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(box().value).toBe("Change it");

    fireEvent.submit(box().closest("form") as HTMLFormElement);
    await waitFor(() => expect(posted.chat).toHaveLength(2));
    expect(posted.chat[1]).toMatchObject({ message: "Change it" });
  });

  it("failing for any other reason says the general thing", async () => {
    serve({ chat: () => json({ error: "Internal server error" }, 500) });
    open();
    send("Change it");
    expect(await screen.findByText("error")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();
  });

  it("a dropped connection says the general thing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? Promise.reject(new TypeError("Load failed")) : json({ conversations: [] }))));
    open();
    send("Change it");
    expect(await screen.findByText("error")).toBeTruthy();
  });
});

describe("a proposal on screen", () => {
  it("shows as not applied, whatever the message said", async () => {
    serve({ chat: () => json(proposing()) });
    open();
    send("Change it");
    await applyButton();
    expect(screen.getByText("actionBadge.noChanges")).toBeTruthy();
  });

  it("a reply of yes is the tap it meant: applied, with no new question to the assistant", async () => {
    const { posted } = serve({ chat: () => json(proposing()) });
    open();
    send("Change it");
    await applyButton();
    send("yes please");
    await waitFor(() => expect(posted.apply).toHaveLength(1));
    expect(posted.chat).toHaveLength(1);
    expect(screen.getByText("yes please")).toBeTruthy();
    expect(box().value).toBe("");
  });

  it("any other reply says the proposal has gone, and is asked", async () => {
    const { posted } = serve({ chat: (body) => json(body.message === "Change it" ? proposing() : reply("Noted.")) });
    open();
    send("Change it");
    await applyButton();
    send("Actually, is it far?");
    expect(await screen.findByText("Noted.")).toBeTruthy();
    expect(screen.getByText("cancelledMessage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /applyChange/ })).toBeNull();
    expect(posted.apply).toEqual([]);
    expect(posted.chat[1]).toMatchObject({ message: "Actually, is it far?" });
  });

  it("the cancel button says the same, and asks nothing", async () => {
    const { posted } = serve({ chat: () => json(proposing()) });
    open();
    send("Change it");
    fireEvent.click((await cardButtons())[2]);
    expect(await screen.findByText("cancelledMessage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /applyChange/ })).toBeNull();
    expect(posted.chat).toHaveLength(1);
    expect(posted.apply).toEqual([]);
  });

  it("another try asks again, about the last question", async () => {
    const { posted } = serve({ chat: () => json(proposing()) });
    open();
    send("Change it");
    fireEvent.click((await cardButtons())[1]);
    await waitFor(() => expect(posted.chat).toHaveLength(2));
    expect(posted.chat[1].message).toMatch(/tryDifferent .*Change it/);
  });
});

describe("applying", () => {
  it("runs in the trip's write queue, brings in the trip, and shows the day it changed", async () => {
    const order: string[] = [];
    const { posted } = serve({ chat: () => json(proposing()) });
    const onRefetchTrip = vi.fn(async () => {
      order.push("refetch");
    });
    const onFocusDay = vi.fn(() => {
      order.push("focus");
    });
    const runItineraryWrite = async <T,>(task: () => Promise<T>) => {
      order.push("queue");
      const out = await task();
      order.push("done");
      return out;
    };
    open({ onRefetchTrip, onFocusDay, runItineraryWrite });
    send("Change it");
    fireEvent.click(await applyButton());
    await waitFor(() => expect(order).toEqual(["queue", "refetch", "focus", "done"]));
    expect(onFocusDay).toHaveBeenCalledWith(1);
    expect(posted.apply[0]).toMatchObject({ tripId: "trip-1", conversationId: "conv-1", changeType: "apply_draft" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /applyChange/ })).toBeNull());
  });

  it("refused, says why and keeps the proposal", async () => {
    serve({ chat: () => json(proposing()), apply: () => json({ code: "OUTDATED" }, 409) });
    open();
    send("Change it");
    fireEvent.click(await applyButton());
    expect(await screen.findByText("errors.outdated")).toBeTruthy();
    expect(screen.getByRole("button", { name: /applyChange/ })).toBeTruthy();
  });

  it("failing for another reason says it couldn't, and keeps the proposal", async () => {
    serve({ chat: () => json(proposing()), apply: () => json({}, 500) });
    open();
    send("Change it");
    fireEvent.click(await applyButton());
    expect(await screen.findByText("errors.applyFailed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /applyChange/ })).toBeTruthy();
  });

  it("blocked by the write queue, says the queue's words", async () => {
    serve({ chat: () => json(proposing()) });
    const runItineraryWrite = vi.fn(async () => {
      throw new ItineraryWriteBlockedError("Your edits couldn't be saved first.");
    });
    open({ runItineraryWrite: runItineraryWrite as never });
    send("Change it");
    fireEvent.click(await applyButton());
    expect(await screen.findByText("Your edits couldn't be saved first.")).toBeTruthy();
  });
});

describe("undoing", () => {
  async function applied(answers: Answers) {
    const served = serve({ chat: () => json(proposing()), ...answers });
    const onRefetchTrip = vi.fn(async () => {});
    open({ onRefetchTrip });
    send("Change it");
    fireEvent.click(await applyButton());
    return { ...served, onRefetchTrip, undo: await screen.findByRole("button", { name: /undoButton/ }) };
  }

  it("restores what the change held, notes it in the conversation, and brings in the trip", async () => {
    const { posted, onRefetchTrip, undo } = await applied({});
    onRefetchTrip.mockClear();
    fireEvent.click(undo);
    expect(await screen.findByText("undoSuccess")).toBeTruthy();
    expect(posted.undo[0]).toMatchObject({ tripId: "trip-1", previousItinerary: days, expectedVersion: 8 });
    expect(onRefetchTrip).toHaveBeenCalledTimes(1);
  });

  it("refused because the trip moved on, says so", async () => {
    const { undo } = await applied({ undo: () => json({}, 409) });
    fireEvent.click(undo);
    expect(await screen.findByText("errors.undoOutdated")).toBeTruthy();
    expect(screen.queryByText("undoSuccess")).toBeNull();
  });

  it("failing, says it couldn't", async () => {
    const { undo } = await applied({ undo: () => json({}, 500) });
    fireEvent.click(undo);
    expect(await screen.findByText("errors.undoFailed")).toBeTruthy();
  });

  it("a new question takes the offer away", async () => {
    await applied({});
    send("Another question");
    await waitFor(() => expect(screen.queryByRole("button", { name: /undoButton/ })).toBeNull());
  });
});

describe("clearing the conversation", () => {
  it("forgets the messages, the id, what's left and any proposal", async () => {
    const { posted } = serve({ chat: () => json(proposing()) });
    open();
    send("Change it");
    await applyButton();
    fireEvent.click(screen.getByTitle("clearConversation"));
    expect(screen.queryByText("Change it")).toBeNull();
    expect(screen.queryByRole("button", { name: /applyChange/ })).toBeNull();
    expect(screen.queryByText(/requestsLeft/)).toBeNull();
    send("Fresh start");
    await waitFor(() => expect(posted.chat).toHaveLength(2));
    expect(posted.chat[1]).toMatchObject({ conversationId: null });
    expect(screen.queryByText("cancelledMessage")).toBeNull();
  });
});
