import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";
import AddActivityButton from "./AddActivityButton";
import { ProposeActivitySheet } from "@/components/collaboration/proposals/ProposeActivitySheet";

/** /api/activities/search answering from a table keyed by the typed query. */
function stubSearch(byQuery: Record<string, string[]>) {
  const bodies: { query: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      const results = (byQuery[body.query] ?? []).map((name, i) => ({
        id: `${name}-${i}`,
        name,
        type: "attraction",
        description: `${name}, described`,
        duration_minutes: 60,
        source: "local",
      }));
      return { ok: true, json: async () => ({ results }) };
    })
  );
  return bodies;
}

const withIntl = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={{ common }}>
    {ui}
  </NextIntlClientProvider>
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AddActivityButton's search", () => {
  it("suggests on open, searches what is typed, and adds the pick", async () => {
    vi.useFakeTimers();
    const bodies = stubSearch({ "": ["Belém Tower"], Alfama: ["Alfama walk"] });
    const onAdd = vi.fn();
    render(withIntl(<AddActivityButton dayIndex={0} destination="Lisbon" onAdd={onAdd} />));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /add activity/i })));
    expect(screen.getByText("Belém Tower")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search activities in Lisbon..."), { target: { value: "Alfama" } });
    await act(async () => vi.advanceTimersByTime(300));
    expect(bodies.map((b) => b.query)).toEqual(["", "Alfama"]);

    fireEvent.click(screen.getByText("Alfama walk"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: "Alfama walk" }));
    // Collapsed again; reopening starts from fresh suggestions.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /add activity/i })));
    expect((screen.getByPlaceholderText("Search activities in Lisbon...") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Belém Tower")).toBeTruthy();
  });
});

describe("ProposeActivitySheet's search", () => {
  it("opens on fresh suggestions every time, and a pick goes to the preview", async () => {
    stubSearch({ "": ["Belém Tower"], Sintra: ["Pena Palace"] });
    const props = {
      onClose: () => {},
      tripId: "t1",
      destination: "Lisbon",
      targetDay: 1,
      onPropose: async () => {},
    };
    const { rerender } = render(withIntl(<ProposeActivitySheet isOpen {...props} />));
    await act(async () => {});
    expect(screen.getByText("Belém Tower")).toBeTruthy();

    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("Search activities in Lisbon..."), { target: { value: "Sintra" } });
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByText("Pena Palace")).toBeTruthy();
    vi.useRealTimers();

    // Closed and opened again: the old query and results are gone, the
    // suggestions are back.
    rerender(withIntl(<ProposeActivitySheet isOpen={false} {...props} />));
    rerender(withIntl(<ProposeActivitySheet isOpen {...props} />));
    await act(async () => {});
    expect((screen.getByPlaceholderText("Search activities in Lisbon...") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Belém Tower")).toBeTruthy();

    fireEvent.click(screen.getByText("Belém Tower"));
    expect(screen.getByText(common.proposeActivity.preview.noteLabel)).toBeTruthy();
  });
});
