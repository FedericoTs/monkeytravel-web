import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const TOKEN = "T".repeat(22);
const emailKeptPlan = vi.fn();
const capture = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => (values?.email ? `${key}:${values.email}` : key),
  useLocale: () => "it",
}));
vi.mock("@/lib/plans/kept-plans-client", () => ({ emailKeptPlan: (...args: unknown[]) => emailKeptPlan(...args) }));
vi.mock("@/lib/posthog", () => ({ capture: (...args: unknown[]) => capture(...args) }));

import { EmailPlanCard } from "./EmailPlanCard";

const input = () => screen.getByLabelText("wizard.kept.emailLabel") as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "wizard.kept.emailSend" }));

beforeEach(() => {
  emailKeptPlan.mockReset();
  emailKeptPlan.mockResolvedValue("sent");
  capture.mockReset();
});

afterEach(cleanup);

describe("asking for the plan's link by email", () => {
  it("sends this plan to the address typed, in the page's language, and says where it went", async () => {
    render(<EmailPlanCard token={TOKEN} offered={false} onClose={() => {}} />);
    type("  ana@example.com ");
    send();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("wizard.kept.emailSent:ana@example.com"));
    expect(emailKeptPlan).toHaveBeenCalledWith(TOKEN, "ana@example.com", "it");
    expect(capture).toHaveBeenCalledWith("kept_plan_email", { outcome: "sent", offered: false });
    expect(screen.queryByLabelText("wizard.kept.emailLabel")).toBeNull();
  });

  it("sends nothing with no address", () => {
    render(<EmailPlanCard token={TOKEN} offered={false} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: "wizard.kept.emailSend" }) as HTMLButtonElement).disabled).toBe(true);
    type("   ");
    fireEvent.submit(input().closest("form")!);
    expect(emailKeptPlan).not.toHaveBeenCalled();
  });

  it("sends once while one is under way", async () => {
    let answer!: (outcome: string) => void;
    emailKeptPlan.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    render(<EmailPlanCard token={TOKEN} offered={false} onClose={() => {}} />);
    type("ana@example.com");
    send();
    const busy = await screen.findByRole("button", { name: "wizard.kept.emailSending" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(input().closest("form")!);
    expect(emailKeptPlan).toHaveBeenCalledTimes(1);
    answer("sent");
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  });

  it.each([
    ["invalid", "wizard.kept.emailInvalid"],
    ["limited", "wizard.kept.emailLimited"],
    ["failed", "wizard.kept.emailFailed"],
  ])("says why when the answer is %s, and leaves the address to fix", async (outcome, message) => {
    emailKeptPlan.mockResolvedValueOnce(outcome);
    render(<EmailPlanCard token={TOKEN} offered={false} onClose={() => {}} />);
    type("ana@example.com");
    send();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
    expect(input().value).toBe("ana@example.com");
    expect(capture).toHaveBeenCalledWith("kept_plan_email", { outcome, offered: false });
  });

  it("clears the reason on a try that works", async () => {
    emailKeptPlan.mockResolvedValueOnce("failed");
    render(<EmailPlanCard token={TOKEN} offered={false} onClose={() => {}} />);
    type("ana@example.com");
    send();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    send();
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the card itself", () => {
  it("opens with the keyboard ready when it was asked for", () => {
    render(<EmailPlanCard token={TOKEN} offered={false} onClose={() => {}} />);
    expect(screen.getByRole("heading").textContent).toBe("wizard.kept.emailAction");
    expect(document.activeElement).toBe(input());
  });

  it("says why it's there and leaves the keyboard shut when it's offered", () => {
    render(<EmailPlanCard token={TOKEN} offered onClose={() => {}} />);
    expect(screen.getByRole("heading").textContent).toBe("wizard.kept.emailOffer");
    expect(document.activeElement).not.toBe(input());
  });

  it("says no account is needed", () => {
    render(<EmailPlanCard token={TOKEN} offered onClose={() => {}} />);
    expect(screen.getByText("wizard.kept.emailNote")).toBeTruthy();
  });

  it("is named by its heading, and doesn't lock the page like a dialog", () => {
    render(<EmailPlanCard token={TOKEN} offered onClose={() => {}} />);
    expect(screen.getByRole("region", { name: "wizard.kept.emailOffer" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with its X and with Escape, and stops listening once gone", () => {
    const onClose = vi.fn();
    const { unmount } = render(<EmailPlanCard token={TOKEN} offered onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "closeModal" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
