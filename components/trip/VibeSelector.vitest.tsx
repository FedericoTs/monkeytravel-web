import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
});
