import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Half of the assistant's edits waited for an Apply tap that never came, while
 * their replies read as if the plan had changed. With Undo on offer, an edit
 * applies as soon as it arrives; Undo puts the plan back.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
const prefs = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/locale", () => ({ useLocale: () => ({ setPreferredCurrency: vi.fn(), ...prefs.current }) }));
vi.mock("@/lib/posthog/events", () => ({ capture: vi.fn(), captureRefineSuggestionClicked: vi.fn() }));
vi.mock("@/lib/trip/refine-suggestions", () => ({ deriveRefineSuggestions: () => [] }));

import AnonAssistantPanel from "./AnonAssistantPanel";
import { capture } from "@/lib/posthog/events";
import type { ItineraryDay } from "@/types";

const days = [1, 2, 3].map((n) => ({ day_number: n, theme: `Day ${n}`, activities: [{ name: `Place ${n}` }] })) as unknown as ItineraryDay[];
const reply = (day: number) => ({
  data: {
    reply: `I've updated Day ${day}.`,
    edits: [{ day_number: day, summary: "Slower morning", activities: [{ name: `New place ${day}` }] }],
  },
});

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  prefs.current = {};
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(reply(2)), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

function renderPanel(props: {
  onApplyEdits?: () => string | void;
  onUndoEdits?: (id: string) => boolean;
  onPlanElsewhere?: (place: string) => void;
}) {
  const onApplyEdits = vi.fn(props.onApplyEdits ?? (() => "edit-1"));
  const { unmount } = render(
    <AnonAssistantPanel
      destination="Lisbon, Portugal"
      tripTitle="Lisbon"
      days={days}
      onApplyEdits={onApplyEdits}
      onUndoEdits={props.onUndoEdits}
      onPlanElsewhere={props.onPlanElsewhere}
    />
  );
  return { onApplyEdits, unmount };
}

async function ask(text = "make day 2 slower") {
  fireEvent.change(screen.getByPlaceholderText("assistant.placeholder"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "assistant.ask" }));
}

describe("a question put from elsewhere on the page", () => {
  const panel = (asked: { id: number; message: string } | null) => (
    <AnonAssistantPanel destination="Lisbon, Portugal" tripTitle="Lisbon" days={days} onApplyEdits={() => "edit-1"} onUndoEdits={() => true} asked={asked} />
  );
  const asks = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).message as string);

  it("is asked here, once per id", async () => {
    const { rerender } = render(panel(null));
    expect(asks()).toEqual([]);

    rerender(panel({ id: 1, message: "Lighten day 2" }));
    await waitFor(() => expect(asks()).toEqual(["Lighten day 2"]));
    await screen.findByText("assistant.updatedDay");

    rerender(panel({ id: 1, message: "Lighten day 2" }));
    expect(asks()).toEqual(["Lighten day 2"]);

    rerender(panel({ id: 2, message: "Lighten day 3" }));
    await waitFor(() => expect(asks()).toEqual(["Lighten day 2", "Lighten day 3"]));
  });

  it("isn't asked again when the panel appears with one already there, for a new plan", () => {
    render(panel({ id: 1, message: "Lighten day 2" }));
    expect(asks()).toEqual([]);
  });

  it("brings the panel into view", async () => {
    const scrolled = vi.fn();
    const { rerender, container } = render(panel(null));
    (container.querySelector("section") as HTMLElement).scrollIntoView = scrolled;
    rerender(panel({ id: 1, message: "Lighten day 2" }));
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(asks()).toEqual(["Lighten day 2"]));
  });
});

describe("with Undo on offer", () => {
  it("applies an edit as soon as it arrives, and tells the server so", async () => {
    const { onApplyEdits } = renderPanel({ onUndoEdits: () => true });
    await ask();
    await waitFor(() => expect(screen.getByText("assistant.updatedDay")).toBeTruthy());
    expect(onApplyEdits).toHaveBeenCalledTimes(1);
    const [edits] = onApplyEdits.mock.calls[0] as unknown as [Array<{ day_number: number }>];
    expect(edits[0].day_number).toBe(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).autoApply).toBe(true);
    expect(screen.queryByRole("button", { name: "assistant.apply" })).toBeNull();
    expect(capture).toHaveBeenCalledWith("anon_assistant_edit_applied", expect.objectContaining({ auto: true }));
  });

  it("undoes it, and offers Apply again", async () => {
    const onUndoEdits = vi.fn(() => true);
    const { onApplyEdits } = renderPanel({ onUndoEdits });
    await ask();
    fireEvent.click(await screen.findByRole("button", { name: "assistant.undo" }));
    expect(onUndoEdits).toHaveBeenCalledWith("edit-1");
    expect(screen.getByText("assistant.editPreview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "assistant.apply" }));
    expect(onApplyEdits).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "assistant.undo" })).toBeTruthy();
  });

  it("says so when the plan has changed since and nothing was undone", async () => {
    renderPanel({ onUndoEdits: () => false });
    await ask();
    fireEvent.click(await screen.findByRole("button", { name: "assistant.undo" }));
    expect(screen.getByText("assistant.undoGone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "assistant.undo" })).toBeNull();
  });

  it("offers Undo on the newest applied edit only", async () => {
    let n = 0;
    renderPanel({ onApplyEdits: () => `edit-${++n}`, onUndoEdits: () => true });
    await ask("make day 2 slower");
    await screen.findByRole("button", { name: "assistant.undo" });
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(reply(3)), { status: 200 }));
    await ask("and day 3");
    await waitFor(() => expect(screen.getAllByText("assistant.updatedDay")).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: "assistant.undo" })).toHaveLength(1);
  });
});

describe("a question that fails", () => {
  const box = () => screen.getByPlaceholderText("assistant.placeholder") as HTMLInputElement;

  it.each([
    ["the model out of service", 503, { error: "unavailable", code: "MODEL_OUTAGE" }, "errors.modelOutage"],
    ["the model failing", 500, { error: "Assistant request failed." }, "assistant.errorBig"],
    ["a refusal", 400, { error: "Invalid assistant payload" }, "assistant.errorMsg"],
    ["today's limit", 429, { error: "limit", reason: "daily_anon" }, "assistant.limitDailyAnon"],
  ])("on %s, says which and puts the question back in the box", async (_name, status, body, words) => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));
    renderPanel({ onUndoEdits: () => true });
    await ask("make day 2 slower");
    expect(await screen.findByText(words)).toBeTruthy();
    expect(box().value).toBe("make day 2 slower");
  });

  it("on a dropped connection, too", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Load failed");
    });
    renderPanel({ onUndoEdits: () => true });
    await ask("make day 2 slower");
    expect(await screen.findByText("assistant.errorMsg")).toBeTruthy();
    expect(box().value).toBe("make day 2 slower");
  });
});

describe("an answer for a panel that has gone", () => {
  it("changes nothing", async () => {
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { onApplyEdits, unmount } = renderPanel({ onUndoEdits: () => true });
    await ask();
    unmount();
    answer(new Response(JSON.stringify(reply(2)), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onApplyEdits).not.toHaveBeenCalled();
  });
});

describe("without Undo", () => {
  it("still asks before changing anything", async () => {
    const { onApplyEdits } = renderPanel({});
    await ask();
    await screen.findByRole("button", { name: "assistant.apply" });
    expect(onApplyEdits).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).autoApply).toBe(false);
  });
});

/**
 * Asked for another place for the whole trip, the assistant offers places; the
 * page plans the one picked anew, for the same dates.
 */
describe("another place for the whole trip", () => {
  const offer = {
    data: {
      reply: "Madeira suits a road trip; Porto, a city break.",
      edits: [],
      elsewhere: [
        { name: "Madeira", country: "Portugal" },
        { name: "Porto", country: "Portugal" },
      ],
    },
  };

  it("offers each place as a button that plans it, changing nothing yet", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(offer), { status: 200 }));
    const onPlanElsewhere = vi.fn();
    const { onApplyEdits } = renderPanel({ onUndoEdits: () => true, onPlanElsewhere });
    await ask("we'd rather do Madeira by car");
    const buttons = await screen.findAllByRole("button", { name: "assistant.planElsewhere" });
    expect(buttons).toHaveLength(2);
    expect(screen.getByText("Madeira suits a road trip; Porto, a city break.")).toBeTruthy();
    fireEvent.click(buttons[1]);
    expect(onPlanElsewhere).toHaveBeenCalledWith("Porto, Portugal");
    expect(onApplyEdits).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith("anon_assistant_plan_elsewhere", { destination: "Lisbon, Portugal", place: "Porto, Portugal" });
  });

  it("shows the answer without buttons on a page that can't plan another place", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(offer), { status: 200 }));
    renderPanel({ onUndoEdits: () => true });
    await ask("we'd rather do Madeira by car");
    await screen.findByText("Madeira suits a road trip; Porto, a city break.");
    expect(screen.queryByRole("button", { name: "assistant.planElsewhere" })).toBeNull();
  });
});

describe("the copy exists in every language", () => {
  it.each(["en", "es", "it", "pt"])("%s", async (locale) => {
    const messages = (await import(`../../messages/${locale}/trips.json`)).default as {
      assistant: Record<string, string>;
    };
    for (const key of ["updatedDay", "updatedDays", "undo", "undoGone", "note", "planElsewhere"]) {
      expect(messages.assistant[key]?.trim(), `${locale} ${key}`).toBeTruthy();
    }
    expect(messages.assistant.updatedDay).toContain("{number}");
    expect(messages.assistant.updatedDays).toContain("{days}");
    expect(messages.assistant.planElsewhere).toContain("{place}");
  });
});

describe("figures in the answers", () => {
  it("tells the server the currency the page shows prices in", async () => {
    prefs.current = { preferences: { preferredCurrency: "EUR" }, exchangeRates: { base: "USD", rates: { EUR: 0.9 } } };
    renderPanel({});
    await ask("what is the total?");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).display).toEqual({ currency: "EUR", rate: 0.9 });
  });

  it("sends none while the rates can't convert", async () => {
    prefs.current = { preferences: { preferredCurrency: "EUR" }, exchangeRates: null };
    renderPanel({});
    await ask("what is the total?");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).display).toBeUndefined();
  });
});
