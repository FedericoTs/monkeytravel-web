import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GeminiCreditPanel } from "./GeminiCreditPanel";
import type { CreditEstimate } from "@/lib/ops/gemini-credit";

const estimate: CreditEstimate = {
  reading: { usd: 50, at: "2026-11-05T15:00:00.000Z" },
  spentUsd: 4.5,
  usd: 45.5,
  perDayUsd: 2,
  lasts: "about 22 days",
  low: false,
};

const type = (usd: string) => {
  fireEvent.change(screen.getByLabelText(/balance/i), { target: { value: usd } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Gemini credit panel", () => {
  it("gives what's left, how long it lasts and where the figure comes from", () => {
    render(<GeminiCreditPanel credit={estimate} onSaved={() => {}} />);
    expect(screen.getByText("About $45.50 left, about 22 days")).toBeTruthy();
    const from = screen.getByTestId("gemini-credit-from").textContent;
    expect(from).toContain("$50.00");
    expect(from).toContain("2026-11-05");
    expect(from).toContain("$4.50");
    expect(from).toContain("$2.00 a day");
    expect(screen.queryByText(/running low/i)).toBeNull();
  });

  it("says when it's running low", () => {
    render(<GeminiCreditPanel credit={{ ...estimate, usd: 5, lasts: "about 2 days", low: true }} onSaved={() => {}} />);
    expect(screen.getByText(/running low/i)).toBeTruthy();
    expect(screen.getByText("About $5.00 left, about 2 days")).toBeTruthy();
  });

  it("gives no days when it can't tell", () => {
    render(<GeminiCreditPanel credit={{ ...estimate, lasts: null }} onSaved={() => {}} />);
    expect(screen.getByText("About $45.50 left")).toBeTruthy();
  });

  it("asks for the balance when none was typed, and links to where Google shows it", () => {
    render(<GeminiCreditPanel credit={null} onSaved={() => {}} />);
    expect(screen.getByText(/type the balance/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /ai studio/i }).getAttribute("href")).toBe("https://aistudio.google.com/billing");
  });

  it("sends the balance typed and reloads the tab", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<GeminiCreditPanel credit={null} onSaved={onSaved} />);
    type("42.50");

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/costs/credit",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ usd: 42.5 }) })
    );
    expect((screen.getByLabelText(/balance/i) as HTMLInputElement).value).toBe("");
  });

  it("says when the balance wasn't saved, and keeps it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const onSaved = vi.fn();
    render(<GeminiCreditPanel credit={null} onSaved={onSaved} />);
    type("42.50");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/balance/i) as HTMLInputElement).value).toBe("42.50");
  });

  it("says so when the request fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<GeminiCreditPanel credit={null} onSaved={() => {}} />);
    type("42.50");
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
