import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

const captured = vi.hoisted(() => vi.fn());
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/posthog/events", () => ({ captureTripIntentSelected: captured }));

import TripOptions from "./TripOptions";

type Props = ComponentProps<typeof TripOptions>;
const setTravelStyle = vi.fn();
const setTripIntent = vi.fn();
const setChildrenAges = vi.fn();
const options = (over: Partial<Props> = {}) =>
  render(
    <TripOptions
      travelStyle="classic"
      setTravelStyle={setTravelStyle}
      tripIntent="unspecified"
      setTripIntent={setTripIntent}
      childrenAges={[]}
      setChildrenAges={setChildrenAges}
      {...over}
    />
  );

beforeEach(() => [captured, setTravelStyle, setTripIntent, setChildrenAges].forEach((fn) => fn.mockClear()));
afterEach(cleanup);

const ageButtons = () => screen.queryAllByRole("button").filter((b) => /wizard\.step1\.ages\./.test(b.textContent ?? ""));

describe("TripOptions", () => {
  it("shows backpacker mode only while it is on, and switches it off", () => {
    options();
    expect(screen.queryByText("wizard.step1.backpackerModeOn")).toBeNull();
    cleanup();

    options({ travelStyle: "backpacker" });
    const on = screen.getByRole("button", { name: /wizard\.step1\.backpackerModeOn/ });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(on);
    expect(setTravelStyle).toHaveBeenCalledWith("classic");
  });

  it("records who's coming, and whether the planner changed their answer", () => {
    options();
    fireEvent.click(screen.getByRole("button", { name: /wizard\.step1\.justMe/ }));
    expect(setTripIntent).toHaveBeenLastCalledWith("solo");
    expect(captured).toHaveBeenLastCalledWith({ intent: "solo", changed: false });
    cleanup();

    options({ tripIntent: "solo" });
    expect(screen.getByRole("button", { name: /wizard\.step1\.justMe/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /wizard\.step1\.withFriends/ }));
    expect(setTripIntent).toHaveBeenLastCalledWith("group");
    expect(captured).toHaveBeenLastCalledWith({ intent: "group", changed: true });
  });

  it("offers four answers, in order, and records a couple and a family", () => {
    options();
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.filter((l) => /justMe|couple|family|withFriends/.test(l ?? ""))).toEqual([
      expect.stringContaining("wizard.step1.justMe"),
      expect.stringContaining("wizard.step1.couple"),
      expect.stringContaining("wizard.step1.family"),
      expect.stringContaining("wizard.step1.withFriends"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /wizard\.step1\.couple/ }));
    expect(setTripIntent).toHaveBeenLastCalledWith("couple");
    fireEvent.click(screen.getByRole("button", { name: /wizard\.step1\.family/ }));
    expect(setTripIntent).toHaveBeenLastCalledWith("family");
    expect(captured).toHaveBeenLastCalledWith({ intent: "family", changed: false });
  });

  it("tells only friends that they can invite each other to vote", () => {
    for (const tripIntent of ["couple", "family"] as const) {
      options({ tripIntent });
      expect(screen.queryByText("wizard.step1.withFriendsHint")).toBeNull();
      cleanup();
    }
  });

  it("tells a group what happens next", () => {
    options({ tripIntent: "group" });
    expect(screen.getByText("wizard.step1.withFriendsHint")).toBeTruthy();
    cleanup();
    options({ tripIntent: "solo" });
    expect(screen.queryByText("wizard.step1.withFriendsHint")).toBeNull();
  });

  it("asks a family how old the children are, and no one else", () => {
    for (const tripIntent of ["unspecified", "solo", "couple", "group"] as const) {
      options({ tripIntent, childrenAges: ["under3"] });
      expect(screen.queryByRole("group", { name: /wizard\.step1\.ages\.label/ }), tripIntent).toBeNull();
      expect(ageButtons(), tripIntent).toEqual([]);
      cleanup();
    }

    options({ tripIntent: "family" });
    expect(screen.getByRole("group", { name: /wizard\.step1\.ages\.label/ })).toBeTruthy();
    expect(screen.getByText("wizard.step1.ages.hint")).toBeTruthy();
    expect(ageButtons().map((b) => b.textContent)).toEqual([
      "wizard.step1.ages.under3",
      "wizard.step1.ages.3to6",
      "wizard.step1.ages.7to12",
      "wizard.step1.ages.teen",
    ]);
  });

  it("shows the ages picked, several at once", () => {
    options({ tripIntent: "family", childrenAges: ["under3", "teen"] });
    expect(ageButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "true"]);
  });

  it("adds an age to those picked, youngest first, and takes one off", () => {
    options({ tripIntent: "family", childrenAges: ["teen"] });
    fireEvent.click(screen.getByRole("button", { name: "wizard.step1.ages.3to6" }));
    expect(setChildrenAges).toHaveBeenLastCalledWith(["3to6", "teen"]);
    cleanup();

    options({ tripIntent: "family", childrenAges: ["under3", "7to12"] });
    fireEvent.click(screen.getByRole("button", { name: "wizard.step1.ages.under3" }));
    expect(setChildrenAges).toHaveBeenLastCalledWith(["7to12"]);
    expect(setTripIntent).not.toHaveBeenCalled();
  });
});
