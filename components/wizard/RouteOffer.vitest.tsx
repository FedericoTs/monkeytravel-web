import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import RouteOffer from "./RouteOffer";

const ROUTE = [
  { city: "Bangkok", nights: 3 },
  { city: "Chiang Mai", nights: 4 },
  { city: "Phuket", nights: 7 },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RouteOffer", () => {
  it("shows the route through the place typed, its cities in order, says Continue plans it, and opens it in one tap", () => {
    const onTake = vi.fn();
    const onKeep = vi.fn();
    render(<RouteOffer place="Thailand" days={14} route={ROUTE} onTake={onTake} onKeep={onKeep} />);
    expect(screen.getByText('wizard.routeOffer.title {"place":"Thailand","days":14}')).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.replace("→", "").trim())).toEqual([
      'wizard.routeOffer.stop {"city":"Bangkok","nights":3}',
      'wizard.routeOffer.stop {"city":"Chiang Mai","nights":4}',
      'wizard.routeOffer.stop {"city":"Phuket","nights":7}',
    ]);
    expect(screen.getByText("wizard.routeOffer.continues")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "wizard.routeOffer.take" }));
    expect(onTake).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
  });

  // Continue plans the route: one place is the traveller's choice, a tap on the card.
  it("plans the place as one place in one tap", () => {
    const onTake = vi.fn();
    const onKeep = vi.fn();
    render(<RouteOffer place="Thailand" days={14} route={ROUTE} onTake={onTake} onKeep={onKeep} />);
    fireEvent.click(screen.getByRole("button", { name: 'wizard.routeOffer.keep {"place":"Thailand"}' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onTake).not.toHaveBeenCalled();
  });

  // On a phone the offer arrives under the fixed Continue bar.
  const arriving = (bottom: number) => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(812);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ bottom } as DOMRect);
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scroll, configurable: true, writable: true });
    return scroll;
  };

  it("comes into view once when it arrives under the Continue bar", () => {
    const scroll = arriving(760);
    render(<RouteOffer place="Thailand" days={14} route={ROUTE} onTake={() => {}} onKeep={() => {}} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0][0]).toMatchObject({ block: "nearest" });
  });

  it("stays where it is when the screen already shows it, or while the traveller types", () => {
    const scroll = arriving(600);
    render(<RouteOffer place="Thailand" days={14} route={ROUTE} onTake={() => {}} onKeep={() => {}} />);
    expect(scroll).not.toHaveBeenCalled();
    cleanup();

    const typing = arriving(760);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    render(<RouteOffer place="Thailand" days={14} route={ROUTE} onTake={() => {}} onKeep={() => {}} />);
    expect(typing).not.toHaveBeenCalled();
    input.remove();
  });
});
