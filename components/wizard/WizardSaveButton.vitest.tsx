import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WizardSaveButton from "./WizardSaveButton";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const autoSave = (over: Partial<{ savedTripId: string | null; status: "idle" | "saving" | "saved" | "error" }> = {}) => ({
  savedTripId: null,
  status: "idle" as const,
  retry: vi.fn(),
  ...over,
});

describe("WizardSaveButton", () => {
  it("leads to the stored trip once auto-save has it", () => {
    render(<WizardSaveButton placement="header" autoSave={autoSave({ savedTripId: "t1", status: "saved" })} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole("link", { name: "result.savedViewTrip" }).getAttribute("href")).toBe("/trips/t1");
  });

  it("shows the save under way, even for a trip stored before", () => {
    render(<WizardSaveButton placement="bar" autoSave={autoSave({ savedTripId: "t1", status: "saving" })} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole("button", { name: "result.saving" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("retries a failed auto-save", () => {
    const state = autoSave({ status: "error" });
    const onSave = vi.fn();
    render(<WizardSaveButton placement="header" autoSave={state} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole("button", { name: "result.retrySave" }));
    expect(state.retry).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("is the manual Save when auto-save is off or has stored nothing", () => {
    const onSave = vi.fn();
    const { rerender } = render(<WizardSaveButton placement="bar" autoSave={null} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole("button", { name: "wizard.result.saveTrip" }));
    rerender(<WizardSaveButton placement="bar" autoSave={autoSave()} onSave={onSave} saving={false} />);
    fireEvent.click(screen.getByRole("button", { name: "wizard.result.saveTrip" }));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("is disabled while the manual save runs", () => {
    render(<WizardSaveButton placement="header" autoSave={null} onSave={vi.fn()} saving />);
    expect(screen.getByRole("button", { name: "wizard.result.saving" }).hasAttribute("disabled")).toBe(true);
  });

  it("fills the phone bar and keeps the header's size", () => {
    const { rerender } = render(<WizardSaveButton placement="bar" autoSave={null} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole("button").className).toContain("flex-1");
    rerender(<WizardSaveButton placement="header" autoSave={null} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole("button").className).toContain("px-6");
    expect(screen.getByRole("button").className).not.toContain("flex-1");
  });
});

describe("WizardSaveButton's colour", () => {
  it.each(["header", "bar"] as const)("saves in the planner's one main-button colour, in the %s", (placement) => {
    render(<WizardSaveButton placement={placement} autoSave={null} onSave={vi.fn()} saving={false} />);
    const button = screen.getByRole("button", { name: "wizard.result.saveTrip" });
    expect(button.className).toContain("bg-[var(--primary)]");
    expect(button.className).toContain("text-white");
    expect(button.className).not.toContain("secondary");
  });

  it("keeps that colour while it saves", () => {
    render(<WizardSaveButton placement="bar" autoSave={autoSave({ status: "saving" })} onSave={vi.fn()} saving={false} />);
    const button = screen.getByRole("button", { name: "result.saving" });
    expect(button.className).toContain("bg-[var(--primary)]");
    expect(button.className).not.toContain("secondary");
  });
});
