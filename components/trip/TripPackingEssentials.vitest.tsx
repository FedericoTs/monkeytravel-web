import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({}) }) }));
// The translator echoes keys, so "packed" below is the key of the "Packed" label.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import TripPackingEssentials from "./TripPackingEssentials";

// Without a tripId nothing is saved, so the test stays inside the component.
const renderList = () => render(<TripPackingEssentials items={["Passport", "Phone charger"]} destination="Lisbon" />);
const checkbox = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
// A ticked row also reads "Packed", so these match the item by the start of its name.
const box = (item: string) => screen.getByRole("checkbox", { name: new RegExp(`^${item}`) }) as HTMLInputElement;

describe("TripPackingEssentials", () => {
  it("ticks an item when its name is clicked, and unticks it on the next click", () => {
    renderList();
    // Once ticked, the row also reads "Packed", so keep the element rather than its name.
    const passport = checkbox("Passport");
    expect(passport.checked).toBe(false);
    expect(screen.queryByText("packed")).toBeNull();

    fireEvent.click(screen.getByText("Passport"));
    expect(passport.checked).toBe(true);
    expect(screen.getByText("packed")).toBeTruthy();

    fireEvent.click(screen.getByText("Passport"));
    expect(passport.checked).toBe(false);
    expect(screen.queryByText("packed")).toBeNull();
  });

  it("is a real checkbox, so it can be reached and toggled from the keyboard", () => {
    renderList();
    const charger = checkbox("Phone charger");
    charger.focus();
    expect(document.activeElement).toBe(charger);
    fireEvent.click(charger); // what Space does on a focused checkbox
    expect(charger.checked).toBe(true);
  });

  it("takes the saved ticks when they arrive", () => {
    const { rerender } = renderList();
    rerender(<TripPackingEssentials items={["Passport", "Phone charger"]} destination="Lisbon" initialChecked={["Passport"]} />);
    expect(box("Passport").checked).toBe(true);
    expect(box("Phone charger").checked).toBe(false);
  });

  it("keeps the visitor's ticks while the page re-renders", () => {
    const { rerender } = renderList();
    fireEvent.click(screen.getByText("Phone charger"));
    rerender(<TripPackingEssentials items={["Passport", "Phone charger"]} destination="Lisbon" />);
    expect(box("Phone charger").checked).toBe(true);
  });

  it("doesn't undo an untick when the same saved ticks come round again", () => {
    const list = (saved: string[]) => <TripPackingEssentials items={["Passport", "Phone charger"]} destination="Lisbon" initialChecked={saved} />;
    const { rerender } = render(list(["Passport"]));
    fireEvent.click(screen.getByText("Passport"));
    expect(box("Passport").checked).toBe(false);
    rerender(list(["Passport"]));
    expect(box("Passport").checked).toBe(false);
  });
});
