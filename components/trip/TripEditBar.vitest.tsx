import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import TripEditBar from "./TripEditBar";

type Props = ComponentProps<typeof TripEditBar>;
const bar = (over: Partial<Props> = {}) => {
  const props: Props = { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: false, hasChanges: false, saveError: null, ...over };
  render(<TripEditBar {...props} />);
  return props;
};

afterEach(cleanup);

describe("TripEditBar", () => {
  it("undoes and redoes while there is something to undo or redo", () => {
    const props = bar();
    fireEvent.click(screen.getByTitle("detail.undo (Cmd+Z)"));
    expect(props.undo).toHaveBeenCalledTimes(1);
    expect((screen.getByTitle("detail.redo (Cmd+Shift+Z)") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when there are unsaved changes, and why a save failed", () => {
    bar();
    expect(screen.queryByText("detail.unsavedChanges")).toBeNull();
    cleanup();

    bar({ hasChanges: true, saveError: "Couldn't save" });
    expect(screen.getByText("detail.unsavedChanges")).toBeTruthy();
    expect(screen.getByText("Couldn't save")).toBeTruthy();
  });
});
