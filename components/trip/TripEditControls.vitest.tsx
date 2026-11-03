import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import TripEditControls from "./TripEditControls";

type Props = ComponentProps<typeof TripEditControls>;
const controls = (over: Partial<Props> = {}) => {
  const props: Props = {
    ambientEdit: false,
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: false,
    saveStatus: "idle",
    onRetrySave: vi.fn(),
    isEditMode: false,
    canEdit: true,
    handleEnterEditMode: vi.fn(),
    handleDiscardChanges: vi.fn(),
    handleSaveChanges: vi.fn(),
    isSaving: false,
    itineraryWritesInFlight: 0,
    hasChanges: false,
    ...over,
  };
  return { props, ...render(<TripEditControls {...props} />) };
};

afterEach(cleanup);

describe("TripEditControls", () => {
  it("gives a solo owner undo and redo while there is something to undo or redo", () => {
    const { props } = controls({ ambientEdit: true });
    fireEvent.click(screen.getByRole("button", { name: "detail.undo" }));
    expect(props.undo).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "detail.redo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("turns the status pill into a retry only after a failed save", () => {
    const failed = controls({ ambientEdit: true, saveStatus: "error" });
    fireEvent.click(screen.getByRole("button", { name: /detail\.saveFailed/ }));
    expect(failed.props.onRetrySave).toHaveBeenCalledTimes(1);
    cleanup();

    controls({ ambientEdit: true, saveStatus: "saved" });
    expect((screen.getByRole("button", { name: /detail\.allChangesSaved/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    controls({ ambientEdit: true, saveStatus: "conflict" });
    expect(screen.getByText("detail.conflictPill")).toBeTruthy();
  });

  it("offers voters and viewers nothing to edit with", () => {
    const { container } = controls({ canEdit: false });
    expect(container.innerHTML).toBe("");
  });

  it("lets an editor enter edit mode, then discard or save", () => {
    const viewing = controls();
    fireEvent.click(screen.getByRole("button", { name: /detail\.editTrip/ }));
    expect(viewing.props.handleEnterEditMode).toHaveBeenCalledTimes(1);
    cleanup();

    const editing = controls({ isEditMode: true, hasChanges: true });
    fireEvent.click(screen.getByRole("button", { name: /detail\.cancel/ }));
    fireEvent.click(screen.getByRole("button", { name: /detail\.saveChanges/ }));
    expect(editing.props.handleDiscardChanges).toHaveBeenCalledTimes(1);
    expect(editing.props.handleSaveChanges).toHaveBeenCalledTimes(1);
  });

  it("holds Save while a save or another write is under way", () => {
    controls({ isEditMode: true, itineraryWritesInFlight: 1 });
    expect((screen.getByRole("button", { name: /detail\.doneEditing/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    controls({ isEditMode: true, isSaving: true });
    expect((screen.getByTitle("detail.doneEditing") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("detail.discardChanges") as HTMLButtonElement).disabled).toBe(true);
  });
});
