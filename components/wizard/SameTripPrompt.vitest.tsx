import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SameTripPrompt from "./SameTripPrompt";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

afterEach(cleanup);

describe("SameTripPrompt", () => {
  it("names the saved trip and passes on the planner's answer", () => {
    const onChoose = vi.fn();
    const { container } = render(<SameTripPrompt twin={{ id: "trip-1", title: "Paris" }} onChoose={onChoose} />);
    expect(screen.getByText('wizard.result.twinTitle {"title":"Paris"}')).toBeTruthy();
    expect(container.querySelector("[data-twin-trip-prompt]")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "wizard.result.twinReplace" }));
    fireEvent.click(screen.getByRole("button", { name: "wizard.result.twinKeepBoth" }));
    expect(onChoose.mock.calls).toEqual([["trip-1"], [null]]);
  });
});
