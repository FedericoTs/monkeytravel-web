import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import TripAssistantButton from "./TripAssistantButton";

afterEach(cleanup);

describe("TripAssistantButton", () => {
  it("floats outside edit mode, and nudges a planner who hasn't opened the assistant", () => {
    const onOpen = vi.fn();
    const { container } = render(<TripAssistantButton isEditMode={false} hasSeenAssistant={false} onOpen={onOpen} />);
    const button = screen.getByTitle("detail.aiTripAssistant");
    expect(button.className).toContain("animate-pulse");
    expect(container.querySelector(".animate-ping")).not.toBeNull();
    expect(screen.getByText("detail.customizeTrip")).toBeTruthy();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    cleanup();

    const seen = render(<TripAssistantButton isEditMode={false} hasSeenAssistant onOpen={vi.fn()} />);
    expect(screen.getByTitle("detail.aiTripAssistant").className).not.toContain("animate-pulse");
    expect(seen.container.querySelector(".animate-ping")).toBeNull();
  });

  it("is a compact button above the edit bar in edit mode", () => {
    const onOpen = vi.fn();
    render(<TripAssistantButton isEditMode hasSeenAssistant={false} onOpen={onOpen} />);
    expect(screen.getByText("detail.aiHelp")).toBeTruthy();
    expect(screen.queryByText("detail.customizeTrip")).toBeNull();
    fireEvent.click(screen.getByTitle("detail.aiTripAssistant"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // On a phone the floating button sat on the first stop while the bar's own
  // assistant button was a thumb away.
  it("leaves a phone's screen to the bar's own button while that one is in view", () => {
    render(<TripAssistantButton isEditMode={false} hasSeenAssistant barButtonInView onOpen={vi.fn()} />);
    expect(screen.getByTitle("detail.aiTripAssistant").className).toContain("max-sm:hidden");
    cleanup();

    render(<TripAssistantButton isEditMode={false} hasSeenAssistant onOpen={vi.fn()} />);
    expect(screen.getByTitle("detail.aiTripAssistant").className).not.toContain("hidden");
    cleanup();

    // In edit mode the bar has no assistant button: the compact one stays.
    render(<TripAssistantButton isEditMode hasSeenAssistant barButtonInView onOpen={vi.fn()} />);
    expect(screen.getByTitle("detail.aiTripAssistant").className).not.toContain("hidden");
  });
});
