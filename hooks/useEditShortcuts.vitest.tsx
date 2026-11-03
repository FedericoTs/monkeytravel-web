import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useEditShortcuts } from "./useEditShortcuts";

/**
 * The trip editor's keyboard shortcuts: undo, redo, save and leave, only
 * while editing and never while typing in a field.
 */

type Props = Parameters<typeof useEditShortcuts>[0];

const editing = (over: Partial<Props> = {}): Props => ({
  editingActive: true,
  ambientEdit: false,
  hasChanges: true,
  isSaving: false,
  conflict: false,
  itineraryWritesInFlight: 0,
  undo: vi.fn(),
  redo: vi.fn(),
  save: vi.fn(),
  setIsEditMode: vi.fn(),
  ...over,
});

function setup(over: Partial<Props> = {}) {
  const props = editing(over);
  const view = renderHook((p: Props) => useEditShortcuts(p), { initialProps: props });
  return { props, view };
}

const press = (key: string, mods: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(e);
  return e;
};

afterEach(cleanup);

describe("useEditShortcuts", () => {
  it("undoes on Cmd+Z or Ctrl+Z, and redoes on Cmd+Shift+Z or Ctrl+Shift+Z", () => {
    const { props } = setup();
    expect(press("z", { metaKey: true }).defaultPrevented).toBe(true);
    press("z", { ctrlKey: true });
    expect(props.undo).toHaveBeenCalledTimes(2);
    expect(props.redo).not.toHaveBeenCalled();

    expect(press("Z", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    press("z", { ctrlKey: true, shiftKey: true });
    expect(props.redo).toHaveBeenCalledTimes(2);
    expect(props.undo).toHaveBeenCalledTimes(2);
  });

  it("saves on Cmd+S, keeping the browser's Save dialog away", () => {
    const { props } = setup();
    expect(press("s", { metaKey: true }).defaultPrevented).toBe(true);
    expect(props.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the editor saves by itself", { ambientEdit: true }],
    ["nothing has changed", { hasChanges: false }],
    ["a save is running", { isSaving: true }],
    ["the trip changed elsewhere", { conflict: true }],
    ["a write is in flight", { itineraryWritesInFlight: 1 }],
  ])("does not save when %s, and still keeps the Save dialog away", (_, over) => {
    const { props } = setup(over);
    expect(press("s", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(props.save).not.toHaveBeenCalled();
  });

  it("leaves edit mode on Escape when nothing has changed", () => {
    const { props } = setup({ hasChanges: false });
    press("Escape");
    expect(props.setIsEditMode).toHaveBeenCalledWith(false);
  });

  it("stays in edit mode on Escape when something has changed", () => {
    const { props } = setup();
    press("Escape");
    expect(props.setIsEditMode).not.toHaveBeenCalled();
  });

  it("follows the editor's state as it changes", () => {
    const { props, view } = setup();
    view.rerender({ ...props, hasChanges: false });
    press("Escape");
    expect(props.setIsEditMode).toHaveBeenCalledWith(false);
  });

  it("does nothing outside editing", () => {
    const { props } = setup({ editingActive: false, hasChanges: false });
    expect(press("z", { metaKey: true }).defaultPrevented).toBe(false);
    expect(press("s", { metaKey: true }).defaultPrevented).toBe(false);
    press("Escape");
    expect(props.undo).not.toHaveBeenCalled();
    expect(props.save).not.toHaveBeenCalled();
    expect(props.setIsEditMode).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "editable"])("leaves keys alone while typing in a field (%s)", (kind) => {
    const field = document.createElement(kind === "editable" ? "div" : kind);
    if (kind === "editable") {
      field.setAttribute("contenteditable", "true");
      // jsdom leaves isContentEditable undefined; a browser reports true here.
      Object.defineProperty(field, "isContentEditable", { value: true });
    }
    document.body.appendChild(field);
    const { props } = setup({ hasChanges: false });
    expect(press("z", { metaKey: true }, field).defaultPrevented).toBe(false);
    press("Escape", {}, field);
    expect(props.undo).not.toHaveBeenCalled();
    expect(props.setIsEditMode).not.toHaveBeenCalled();
    field.remove();
  });

  it("stops listening once unmounted", () => {
    const { props, view } = setup();
    view.unmount();
    press("z", { metaKey: true });
    expect(props.undo).not.toHaveBeenCalled();
  });
});
