import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const capture = vi.fn();
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("@/lib/posthog", () => ({ capture: (...args: unknown[]) => capture(...args) }));

import { SaveBenefitsCard } from "./SaveBenefitsCard";

beforeEach(() => capture.mockReset());
afterEach(cleanup);

describe("the benefits card at the end of a plan", () => {
  it("says what keeping the plan gives, the same three things the save box lists", () => {
    render(<SaveBenefitsCard onSave={() => {}} saving={false} />);
    expect(screen.getByRole("region", { name: "trips.wizard.result.benefitsTitle" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "common.authPrompt.saveBenefits.dayPlan",
      "common.authPrompt.saveBenefits.reminders",
      "common.authPrompt.saveBenefits.group",
    ]);
    expect(screen.getByText("common.authPrompt.saveBenefits.free")).toBeTruthy();
  });

  it("saves the trip from its button, the way the Save button does, and counts the press", () => {
    const onSave = vi.fn();
    render(<SaveBenefitsCard onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole("button", { name: "trips.wizard.result.benefitsCta" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("save_benefits_card_pressed", {});
  });

  it("can't be pressed again while a save is under way", () => {
    const onSave = vi.fn();
    render(<SaveBenefitsCard onSave={onSave} saving />);
    const button = screen.getByRole("button", { name: "trips.wizard.result.benefitsCta" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });
});
