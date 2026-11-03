import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ActivityRow from "./ActivityRow";

afterEach(cleanup);

const segment = { distanceMeters: 800, durationSeconds: 600, distanceText: "800 m", durationText: "10 min", mode: "WALKING" as const };

describe("ActivityRow", () => {
  it("puts the crew's tally above the card and the way to the next activity below it", () => {
    const { container } = render(
      <ActivityRow
        crewVotes={{ byActivity: { a1: { up: 2, down: 1 } } } as never}
        activityId="a1"
        aiUpdated={false}
        travelTo={{ segment, isLoading: false }}
      >
        <div data-testid="card" />
      </ActivityRow>
    );
    const row = container.firstElementChild!;
    expect(row.textContent).toContain("👍2");
    expect(row.children[1].querySelector('[data-testid="card"]')).not.toBeNull();
    expect(row.children[1].className).toBe("");
    expect(row.children.length).toBe(3);
  });

  it("rings a card the assistant has just changed, and ends the day without a connector", () => {
    const { container } = render(
      <ActivityRow crewVotes={null} activityId="a3" aiUpdated travelTo={null}>
        <div data-testid="card" />
      </ActivityRow>
    );
    const row = container.firstElementChild!;
    expect(row.children.length).toBe(1);
    expect(row.children[0].className).toContain("ring-2");
    expect(screen.getByTestId("card")).toBeTruthy();
  });
});
