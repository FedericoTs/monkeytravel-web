import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { useModalBehavior } from "./useModalBehavior";

function Dialog(props: {
  open: boolean;
  onClose: () => void;
  label: string;
  initialFocus?: "panel" | "first";
  closeOnEscape?: boolean;
  children?: ReactNode;
}) {
  const { panelRef } = useModalBehavior({
    isOpen: props.open,
    onClose: props.onClose,
    initialFocus: props.initialFocus,
    closeOnEscape: props.closeOnEscape,
  });
  if (!props.open) return null;
  return (
    <div ref={panelRef} role="dialog" aria-label={props.label} tabIndex={-1}>
      {props.children}
    </div>
  );
}

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const noop = () => {};

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("useModalBehavior", () => {
  it("moves focus into the dialog on open, and back to the opener on close", async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <Dialog open={open} onClose={() => setOpen(false)} label="Settings">
            <button>Save</button>
          </Dialog>
        </>
      );
    }
    const { getByText, getByRole } = render(<Page />);
    const opener = getByText("Open");
    opener.focus();
    fireEvent.click(opener);
    await nextFrame();
    expect(document.activeElement).toBe(getByRole("dialog"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("focuses the first control when asked to", async () => {
    const { getByText } = render(
      <Dialog open onClose={noop} label="Pick a day" initialFocus="first">
        <p>Move to</p>
        <button>Day 1</button>
        <button>Day 2</button>
      </Dialog>,
    );
    await nextFrame();
    expect(document.activeElement).toBe(getByText("Day 1"));
  });

  it("closes only the innermost of two open dialogs on Escape", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onClose={outer} label="Share" />
        <Dialog open onClose={inner} label="Remove this person?" />
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("leaves Escape alone when told to", () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} label="Saving" closeOnEscape={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the page from scrolling until the last open dialog closes", () => {
    document.body.style.overflow = "auto";
    const page = (a: boolean, b: boolean) => (
      <>
        <Dialog open={a} onClose={noop} label="A" />
        <Dialog open={b} onClose={noop} label="B" />
      </>
    );
    const { rerender } = render(page(true, true));
    expect(document.body.style.overflow).toBe("hidden");

    rerender(page(true, false));
    expect(document.body.style.overflow).toBe("hidden");

    rerender(page(false, false));
    expect(document.body.style.overflow).toBe("auto");
  });

  it("keeps Tab inside the dialog", async () => {
    const { getByText, getByRole } = render(
      <Dialog open onClose={noop} label="Rename">
        <button>Cancel</button>
        <button>Rename</button>
      </Dialog>,
    );
    await nextFrame();
    expect(document.activeElement).toBe(getByRole("dialog"));

    // From the panel itself, Shift+Tab goes to the last control, not out.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByText("Rename"));

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByText("Cancel"));

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByText("Rename"));
  });
});
