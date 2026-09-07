import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TripActionsMenu, { TripActionsMenuItem, TripActionsMenuSlot } from "./TripActionsMenu";

/**
 * The "More" overflow for the trip-detail action bar (Phase 5.4). The bar can't
 * be rendered whole in a unit test (owner-gated, 3k-line client), so this pins
 * the isolated menu: it opens on click, holds its rows, closes on Escape and
 * outside-click, and fires a row's action.
 */
describe("TripActionsMenu", () => {
  const setup = () =>
    render(
      <div>
        <button>outside</button>
        <TripActionsMenu label="More">
          <TripActionsMenuSlot>
            <button>Export</button>
          </TripActionsMenuSlot>
          <TripActionsMenuItem onClick={onAdd}>Add from email</TripActionsMenuItem>
        </TripActionsMenu>
      </div>,
    );
  const onAdd = vi.fn();

  it("is closed until the trigger is clicked", () => {
    setup();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Add from email")).toBeTruthy();
    expect(screen.getByText("Export")).toBeTruthy();
  });

  it("marks the trigger expanded when open", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "More" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on an outside click", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("fires a menu item's action", () => {
    onAdd.mockClear();
    setup();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByText("Add from email"));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
