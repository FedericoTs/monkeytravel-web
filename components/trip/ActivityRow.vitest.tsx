import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  // Echoes the key and its values, so a test sees which text and with what.
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));

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

  it("notes a card still on when the next one starts, by how long, with a way to make room", () => {
    const onMakeRoom = vi.fn();
    render(
      <ActivityRow crewVotes={null} activityId="a1" aiUpdated={false} overlap={{ minutes: 105, nextName: "Lunch", onMakeRoom }} travelTo={{ segment, isLoading: false }}>
        <div data-testid="card" />
      </ActivityRow>
    );
    expect(screen.getByRole("note").textContent).toContain('editActivity.overlap {"name":"Lunch","duration":"1 h 45 min"}');
    fireEvent.click(screen.getByRole("button", { name: "editActivity.makeRoom" }));
    expect(onMakeRoom).toHaveBeenCalledTimes(1);
  });

  it("offers no way to make room when the next one is fixed", () => {
    render(
      <ActivityRow crewVotes={null} activityId="a1" aiUpdated={false} overlap={{ minutes: 30, nextName: "Shinkansen", onMakeRoom: null }} travelTo={null}>
        <div data-testid="card" />
      </ActivityRow>
    );
    expect(screen.getByRole("note").textContent).toContain("Shinkansen");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
