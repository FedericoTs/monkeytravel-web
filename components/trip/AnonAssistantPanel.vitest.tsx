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
vi.mock("@/lib/locale", () => ({ useLocale: () => ({ setPreferredCurrency: vi.fn() }) }));
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
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(reply(2)), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

function renderPanel(props: { onApplyEdits?: () => string | void; onUndoEdits?: (id: string) => boolean }) {
  const onApplyEdits = vi.fn(props.onApplyEdits ?? (() => "edit-1"));
  render(
    <AnonAssistantPanel
      destination="Lisbon, Portugal"
      tripTitle="Lisbon"
      days={days}
      onApplyEdits={onApplyEdits}
      onUndoEdits={props.onUndoEdits}
    />
  );
  return { onApplyEdits };
}

async function ask(text = "make day 2 slower") {
  fireEvent.change(screen.getByPlaceholderText("assistant.placeholder"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "assistant.ask" }));
}

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

describe("without Undo", () => {
  it("still asks before changing anything", async () => {
    const { onApplyEdits } = renderPanel({});
    await ask();
    await screen.findByRole("button", { name: "assistant.apply" });
    expect(onApplyEdits).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).autoApply).toBe(false);
  });
});

describe("the copy exists in every language", () => {
  it.each(["en", "es", "it", "pt"])("%s", async (locale) => {
    const messages = (await import(`../../messages/${locale}/trips.json`)).default as {
      assistant: Record<string, string>;
    };
    for (const key of ["updatedDay", "updatedDays", "undo", "undoGone", "note"]) {
      expect(messages.assistant[key]?.trim(), `${locale} ${key}`).toBeTruthy();
    }
    expect(messages.assistant.updatedDay).toContain("{number}");
    expect(messages.assistant.updatedDays).toContain("{days}");
  });
});
