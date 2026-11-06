import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import VibeSelector from "./VibeSelector";

const card = (id: string) => screen.getByRole("button", { name: new RegExp(`types\\.${id}\\.label`) });

describe("VibeSelector", () => {
  it("says which vibes are picked", () => {
    const onVibesChange = vi.fn();
    render(<VibeSelector selectedVibes={["foodie", "nature"]} onVibesChange={onVibesChange} />);
    expect(card("foodie").getAttribute("aria-pressed")).toBe("true");
    expect(card("nature").getAttribute("aria-pressed")).toBe("true");
    expect(card("urban").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(card("urban"));
    expect(onVibesChange).toHaveBeenCalledWith(["foodie", "nature", "urban"]);
  });

  it("keeps a chosen vibe's words in the dark ink, since the vibe's own colour is too pale to read", () => {
    render(<VibeSelector selectedVibes={["foodie"]} onVibesChange={vi.fn()} />);
    const name = within(card("foodie")).getByText("types.foodie.label");
    const priority = within(card("foodie")).getByText("priority.primary");
    expect(name.className).toContain("text-slate-900");
    expect(name.getAttribute("style")).toBeNull();
    expect(priority.className).toContain("text-slate-600");
    expect(priority.getAttribute("style")).toBeNull();
  });

  it("still shows the vibe's colour on the chosen card's edge", () => {
    render(<VibeSelector selectedVibes={["foodie"]} onVibesChange={vi.fn()} />);
    expect(card("foodie").style.borderColor).toBe("var(--vibe-foodie)");
  });
});
