import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { PlacePrediction } from "@/types";

/**
 * The wizard's destination field, from the keyboard and a screen reader.
 *
 * It said role="combobox" but the list had no listbox/option roles and the
 * input pointed at nothing, so screen readers heard neither the suggestions
 * nor the highlighted one; Enter with nothing highlighted did nothing (typing
 * "Lisbon" + Enter picked no destination, and the open list then covered the
 * date presets); and every row was a Tab stop. Found in an end-to-end check
 * of production on 2026-09-25.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
// Search on every keystroke: the 300 ms debounce is not what's under test.
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(v: T) => v }));

import DestinationAutocomplete from "./DestinationAutocomplete";

const place = (id: string, mainText: string, secondaryText: string): PlacePrediction => ({
  placeId: id,
  mainText,
  secondaryText,
  fullText: `${mainText}, ${secondaryText}`,
  countryCode: null,
  flag: "🏳️",
  types: ["(cities)"],
  source: "local",
});

const POPULAR = [place("popular_paris", "Paris", "France"), place("popular_rome", "Rome", "Italy")];
const RESULTS: Record<string, PlacePrediction[]> = {};
const results = (q: string) => RESULTS[q] ?? [place(`${q}-pt`, "Lisbon", "Portugal"), place(`${q}-us`, "Lisbon", "United States")];

beforeEach(() => {
  // jsdom has no scrollIntoView; the component keeps the highlighted row in view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/destinations/popular")) return { json: async () => ({ predictions: POPULAR }) };
      const { input } = JSON.parse(String(init?.body ?? "{}"));
      return { json: async () => ({ predictions: results(input) }) };
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderField() {
  const onSelect = vi.fn();
  function Harness() {
    const [value, setValue] = useState("");
    return <DestinationAutocomplete value={value} onChange={setValue} onSelect={onSelect} />;
  }
  render(<Harness />);
  const input = screen.getByRole("combobox");
  return { input, onSelect };
}

async function type(input: HTMLElement, text: string) {
  act(() => input.focus());
  fireEvent.change(input, { target: { value: text } });
}

/** Focus shows the popular list first; wait for the actual search results. */
const searchResults = () => screen.findByRole("option", { name: /^Lisbon\s*Portugal$/ });

describe("destination field (WAI-ARIA combobox)", () => {
  it("the suggestions are a listbox of options the input points at, and not Tab stops", async () => {
    const { input } = renderField();
    await type(input, "Lisba");
    await searchResults();
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    for (const o of options) expect(o.getAttribute("tabindex")).toBe("-1");
    // The flag and the "City" chip are decorative: the name is the place.
    expect(screen.getByRole("option", { name: /^Lisbon\s*Portugal$/ })).toBeTruthy();
  });

  it("ArrowDown highlights a row the screen reader hears; Enter picks it", async () => {
    const { input, onSelect } = renderField();
    await type(input, "Lisbb");
    await searchResults();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const second = screen.getAllByRole("option")[1];
    expect(input.getAttribute("aria-activedescendant")).toBe(second.id);
    expect(second.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ fullText: "Lisbon, United States" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter with nothing highlighted takes the top search result", async () => {
    const { input, onSelect } = renderField();
    await type(input, "Lisbc");
    await searchResults();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ fullText: "Lisbon, Portugal" }));
  });

  it("Enter on the popular list picks nothing: it doesn't answer what was typed", async () => {
    const { input, onSelect } = renderField();
    act(() => input.focus());
    fireEvent.focus(input);
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("Escape closes the list; ArrowDown opens it again on the first row", async () => {
    const { input } = renderField();
    await type(input, "Lisbd");
    await searchResults();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await screen.findByRole("listbox");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
  });

  it("Escape while a search is still in flight: the results don't reopen the list", async () => {
    let release: (v: unknown) => void = () => {};
    const held = new Promise((r) => (release = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/destinations/popular")) return { json: async () => ({ predictions: POPULAR }) };
        await held;
        return { json: async () => ({ predictions: results("Lisbe") }) };
      })
    );
    const { input } = renderField();
    await type(input, "Lisbe");
    fireEvent.keyDown(input, { key: "Escape" });
    await act(async () => {
      release(null);
      await held;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(await searchResults()).toBeTruthy();
  });

  it("Escape on the no-results panel closes it and keeps focus in the field", async () => {
    RESULTS["Zzyzy"] = [];
    const { input } = renderField();
    await type(input, "Zzyzy");
    await screen.findByText("noResultsExciting");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("noResultsExciting")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("no match: Enter continues with what was typed, like the panel's button", async () => {
    RESULTS["Zzyzx"] = [];
    const { input, onSelect } = renderField();
    await type(input, "Zzyzx");
    await screen.findByText("noResultsExciting");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ mainText: "Zzyzx", source: "manual" }))
    );
  });
});
