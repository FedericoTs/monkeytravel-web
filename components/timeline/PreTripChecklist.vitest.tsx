/** @vitest-environment jsdom */
/**
 * The pre-trip checklist sits above the plan, so whatever it grows by when its
 * items arrive pushes the page down. While they load, the card already has
 * the shape of an empty list (what most trips have), and it opens without a
 * height animation from zero.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PreTripChecklist from "./PreTripChecklist";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const noop = () => {};
const checklist = (isLoading: boolean) => (
  <PreTripChecklist items={[]} onToggle={noop} onAdd={noop} onDelete={noop} isLoading={isLoading} />
);
// The card's boxes, without their text or the class that only hides them.
const shape = (el: Element): string =>
  `${el.tagName}.${[...el.classList].filter((c) => c !== "invisible").join(".")}(${[...el.children].map(shape).join(",")})`;

describe("PreTripChecklist", () => {
  it("keeps the empty list's shape while the items load", () => {
    const { container, rerender } = render(checklist(true));
    const card = container.firstElementChild as HTMLElement;
    const loading = shape(card);
    expect(screen.getByText("emptyState").closest("[aria-hidden]")).not.toBeNull();

    rerender(checklist(false));
    expect(shape(card)).toBe(loading);
    expect(screen.getByText("emptyState").closest("[aria-hidden]")).toBeNull();
  });

  it("opens at its full height on the first render", () => {
    render(checklist(true));
    const body = screen.getByText("emptyState").parentElement?.parentElement as HTMLElement;
    expect(body.style.height).not.toBe("0px");
    expect(body.style.opacity).not.toBe("0");
  });
});
