import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "pt" }));
// Searches as typed: the settle time is the hook's business, tested on its own.
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(value: T) => value }));

import StayField from "./StayField";
import type { TripStay } from "@/types";

/**
 * Step 1's "Where are you staying?": folded until asked for, suggestions near
 * the destination, a pick that carries its place, typed words that don't.
 */

const near = { latitude: 38.7223, longitude: -9.1393 };
const memmo = { name: "Memmo Alfama", detail: "Alfama, Lisbon", lat: 38.7111, lng: -9.1306 };
const fetchMock = vi.fn();
const posted = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
const found = (places: unknown[]) => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ places }) });

function field(stay: TripStay | null = null, at: typeof near | null = near) {
  const onChange = vi.fn();
  const view = render(<StayField stay={stay} onChange={onChange} near={at} />);
  return { onChange, view };
}
const box = () => screen.getByRole("combobox") as HTMLInputElement;

beforeEach(() => {
  fetchMock.mockReset();
  found([]);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("folded until asked for", () => {
  it("is one small link, and opens to the box", () => {
    field();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "wizard.step1.stay.add" }));
    expect(box()).toBeTruthy();
    expect(screen.getByText("wizard.step1.stay.hint")).toBeTruthy();
  });

  it("is open with the stay in the box when there is one", () => {
    field({ name: "Memmo Alfama" });
    expect(box().value).toBe("Memmo Alfama");
  });
});

describe("suggestions near the destination", () => {
  it("searches near it for three letters or more, in the page's language", async () => {
    found([memmo]);
    field({ name: "x" });
    fireEvent.change(box(), { target: { value: "me" } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(box(), { target: { value: "mem" } });
    await screen.findByRole("option");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/places/stay-search");
    expect(posted().at(-1)).toEqual({ input: "mem", near, locale: "pt" });
  });

  it("doesn't search without a destination to search near: typed words still count", async () => {
    const { onChange } = field({ name: "x" }, null);
    fireEvent.change(box(), { target: { value: "Memmo Alfama" } });
    fireEvent.blur(box());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ name: "Memmo Alfama" });
  });

  it("a pick carries its place, and asks for nothing more", async () => {
    found([memmo]);
    const { onChange } = field({ name: "x" });
    fireEvent.change(box(), { target: { value: "memmo" } });
    fireEvent.mouseDown(await screen.findByRole("option"));
    expect(onChange).toHaveBeenCalledWith({ name: "Memmo Alfama", coordinates: { lat: 38.7111, lng: -9.1306 } });
    expect(box().value).toBe("Memmo Alfama");
    expect(screen.queryByRole("option")).toBeNull();
    const searches = fetchMock.mock.calls.length;
    fireEvent.blur(box());
    expect(fetchMock.mock.calls.length).toBe(searches);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("picks with the keyboard too", async () => {
    found([memmo, { ...memmo, name: "Memmo Príncipe Real", lat: 38.716, lng: -9.15 }]);
    const { onChange } = field({ name: "x" });
    fireEvent.change(box(), { target: { value: "memmo" } });
    await screen.findAllByRole("option");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ name: "Memmo Príncipe Real", coordinates: { lat: 38.716, lng: -9.15 } });
  });

  it("shows nothing when the search fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    field({ name: "x" });
    fireEvent.change(box(), { target: { value: "memmo" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("option")).toBeNull();
  });
});

describe("typed words and clearing", () => {
  it("hands over typed words as the stay, cleaned, when the box is left", () => {
    const { onChange } = field({ name: "x" }, null);
    fireEvent.change(box(), { target: { value: "  near   the Rossio  " } });
    fireEvent.blur(box());
    expect(onChange).toHaveBeenCalledWith({ name: "near the Rossio" });
  });

  it("an emptied box is no stay", () => {
    const { onChange } = field({ name: "Alfama" }, null);
    fireEvent.change(box(), { target: { value: "   " } });
    fireEvent.blur(box());
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("clears with its button", () => {
    const { onChange } = field({ name: "Alfama" });
    fireEvent.click(screen.getByRole("button", { name: "wizard.step1.stay.clear" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(box().value).toBe("");
  });

  it("shows a stay set from outside, as a restored draft does", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StayField stay={null} onChange={onChange} near={near} />);
    rerender(<StayField stay={{ name: "Memmo Alfama" }} onChange={onChange} near={near} />);
    expect(box().value).toBe("Memmo Alfama");
    expect(onChange).not.toHaveBeenCalled();
  });
});
