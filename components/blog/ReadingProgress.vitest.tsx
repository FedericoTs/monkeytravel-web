import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/analytics", () => ({ trackContentInteraction: vi.fn() }));

import ReadingProgress from "./ReadingProgress";

describe("the reading bar at the top of an article", () => {
  it("is decoration, so screen readers skip it", () => {
    const { container } = render(<ReadingProgress slug="paris-vs-barcelona" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("progressbar", { hidden: true })).toBeNull();
  });

  it("still fills as the page scrolls", () => {
    const { container } = render(<ReadingProgress />);
    expect((container.firstElementChild as HTMLElement).style.width).toBe("0%");
  });
});
