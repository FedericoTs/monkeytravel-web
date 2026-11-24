/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import PickedByNote from "./PickedByNote";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));

afterEach(cleanup);

describe("PickedByNote", () => {
  it("says whose pick a stop is", () => {
    const { container } = render(<PickedByNote activity={{ picked_by: "  Bo " }} />);
    expect(container.textContent).toBe('pickedBy {"name":"Bo"}');
  });

  it("says nothing on a stop nobody picked, or with no name", () => {
    for (const picked_by of [undefined, "", "   "]) {
      const { container } = render(<PickedByNote activity={{ picked_by }} />);
      expect(container.textContent, String(picked_by)).toBe("");
      cleanup();
    }
  });
});
