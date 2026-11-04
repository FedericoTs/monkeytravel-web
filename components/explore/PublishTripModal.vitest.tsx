/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/posthog/events", () => ({
  captureExploreTripPublished: async () => {},
  captureExploreTripPublishFailed: async () => {},
}));

import PublishTripModal from "./PublishTripModal";

const REFUSAL = "Give the trip a day before publishing.";
const modal = (isOpen: boolean) => (
  <PublishTripModal tripId="trip-1" isOpen={isOpen} onClose={() => {}} defaultAuthorName="Ana" />
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PublishTripModal", () => {
  it("says it in the page's language when the connection drops, not the browser's words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    render(modal(true));
    fireEvent.click(screen.getByRole("button", { name: "publishAction" }));
    expect(await screen.findByText("errorFallback")).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("opens again without the last attempt's error, keeping what was typed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: REFUSAL }), { status: 400 })));
    const { rerender } = render(modal(true));
    const name = () => document.getElementById("author-display-name") as HTMLInputElement;
    const note = () => document.getElementById("author-note") as HTMLTextAreaElement;
    fireEvent.change(note(), { target: { value: "Our honeymoon" } });
    fireEvent.click(screen.getByRole("button", { name: "publishAction" }));
    expect(await screen.findByText(REFUSAL)).toBeTruthy();

    rerender(modal(false));
    rerender(modal(true));
    expect(screen.queryByText(REFUSAL)).toBeNull();
    expect(name().value).toBe("Ana");
    expect(note().value).toBe("Our honeymoon");
  });
});
