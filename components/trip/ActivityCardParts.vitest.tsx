import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Activity } from "@/types";

const gallery = vi.fn();
vi.mock("@/components/PlaceGallery", () => ({
  default: (props: Record<string, unknown>) => {
    gallery(props);
    return <div data-testid="gallery" />;
  },
}));

import { ActivityCardDetails, ActivityKindIcon } from "./ActivityCardParts";

describe("an activity's kind glyph", () => {
  it.each(["restaurant", "attraction", "activity", "transport"] as const)("draws %s at the size it is given", (kind) => {
    const { container } = render(<ActivityKindIcon kind={kind} className="w-3 h-3" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toBe("w-3 h-3");
    expect(svg?.querySelector("path")).not.toBeNull();
  });

  it("draws the four kinds differently", () => {
    const paths = (["restaurant", "attraction", "activity", "transport"] as const).map(
      (kind) => render(<ActivityKindIcon kind={kind} className="w-4 h-4" />).container.innerHTML
    );
    expect(new Set(paths).size).toBe(4);
  });

  it.each(["museum", "shopping", "cafe"] as const)("draws nothing for %s", (kind) => {
    const { container } = render(<ActivityKindIcon kind={kind} className="w-4 h-4" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("a card's expanded panel", () => {
  const activity = {
    name: "Pantheon",
    location: "Rome",
    address: "Piazza della Rotonda",
    image_url: "https://images.example/p.jpg",
    tips: ["Go at opening", "Look up"],
  } as Activity;
  const onPhotoCapture = () => {};

  it("shows the place's photos and the tips under the label", () => {
    render(
      <ActivityCardDetails activity={activity} showGallery disableAutoFetch onPhotoCapture={onPhotoCapture} tipsLabel="Insider Tips" />
    );
    expect(screen.getByTestId("gallery")).toBeTruthy();
    expect(gallery).toHaveBeenLastCalledWith({
      placeName: "Pantheon",
      placeAddress: "Piazza della Rotonda",
      maxPhotos: 5,
      showRating: true,
      disableAutoFetch: true,
      onFirstPhotoFetched: onPhotoCapture,
      existingImageUrl: "https://images.example/p.jpg",
    });
    expect(screen.getByText("Insider Tips")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["•Go at opening", "•Look up"]);
  });

  it("falls back to the location for the gallery's address", () => {
    render(
      <ActivityCardDetails activity={{ ...activity, address: undefined }} showGallery disableAutoFetch={false} onPhotoCapture={onPhotoCapture} tipsLabel="Tips" />
    );
    expect(gallery.mock.lastCall?.[0]).toMatchObject({ placeAddress: "Rome", disableAutoFetch: false });
  });

  it("leaves out the gallery when it is off, and the tips when there are none", () => {
    render(
      <ActivityCardDetails activity={{ ...activity, tips: [] }} showGallery={false} disableAutoFetch={false} onPhotoCapture={onPhotoCapture} tipsLabel="Tips" />
    );
    expect(screen.queryByTestId("gallery")).toBeNull();
    expect(screen.queryByText("Tips")).toBeNull();
  });
});
