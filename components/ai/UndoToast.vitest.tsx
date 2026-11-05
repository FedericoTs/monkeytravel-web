/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import UndoToast from "./UndoToast";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const undoState = (id: string) => ({
  id,
  previousItinerary: [],
  action: { type: "apply_draft", description: "Updated 1 day", dayNumber: 2 },
  timestamp: 1,
});
const undoButton = () => screen.queryByText("undoButton");

afterEach(cleanup);

describe("the undo toast", () => {
  it("shows nothing without a change to undo", () => {
    render(<UndoToast undoState={null} onUndo={() => {}} onDismiss={() => {}} />);
    expect(undoButton()).toBeNull();
  });

  it("shows for a change, and undoes it", async () => {
    const onUndo = vi.fn(async () => {});
    render(<UndoToast undoState={undoState("a")} onUndo={onUndo} onDismiss={() => {}} />);
    await act(async () => fireEvent.click(undoButton()!));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("goes when dismissed, and says so", async () => {
    const onDismiss = vi.fn();
    render(<UndoToast undoState={undoState("a")} onUndo={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(undoButton()).toBeNull());
  });

  it("goes after the undo, even with the same change still given", async () => {
    render(<UndoToast undoState={undoState("a")} onUndo={async () => {}} onDismiss={() => {}} />);
    await act(async () => fireEvent.click(undoButton()!));
    await vi.waitFor(() => expect(undoButton()).toBeNull());
  });

  it("comes back for the next change", async () => {
    const view = render(<UndoToast undoState={undoState("a")} onUndo={() => {}} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    await vi.waitFor(() => expect(undoButton()).toBeNull());
    view.rerender(<UndoToast undoState={undoState("b")} onUndo={() => {}} onDismiss={() => {}} />);
    expect(undoButton()).not.toBeNull();
  });
});
