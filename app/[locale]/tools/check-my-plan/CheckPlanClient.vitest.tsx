/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import itTools from "@/messages/it/tools.json";

const capture = vi.fn();
vi.mock("@/lib/posthog", () => ({ capture: (...args: unknown[]) => capture(...args) }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, onClick, className }: { href: string; children: ReactNode; onClick?: () => void; className?: string }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

import CheckPlanClient, { fixHref } from "./CheckPlanClient";

const words = itTools.checkPlan;
const REPORT = {
  destination: "Roma",
  lookedUp: true,
  looked: 3,
  closed: 1,
  missing: 1,
  packedDays: 1,
  keep: ["Da Enzo", "Colosseo"],
  days: [
    {
      label: "Giorno 1",
      packed: true,
      stops: [
        { name: "Da Enzo", status: "open" },
        { name: "Chiuso da tempo", status: "closed" },
        { name: "Sconosciuto", status: "missing" },
        { name: "Colosseo", status: null },
      ],
    },
    { label: "", packed: false, stops: [{ name: "Pantheon", status: null }] },
  ],
};

function answers(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function open() {
  render(
    <NextIntlClientProvider locale="it" messages={{ tools: itTools }}>
      <CheckPlanClient />
    </NextIntlClientProvider>,
  );
}

const check = (text = "Giorno 1: Colosseo, poi Da Enzo") => {
  fireEvent.change(screen.getByLabelText(words.label), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: words.check }));
};

beforeEach(() => capture.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("asking for a check", () => {
  it("has nothing to send until there's a plan", () => {
    open();
    const button = screen.getByRole("button", { name: words.check }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(words.label), { target: { value: "   " } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(words.label), { target: { value: "Giorno 1" } });
    expect(button.disabled).toBe(false);
  });

  it("sends the text it was given", async () => {
    const fetchMock = answers(200, REPORT);
    open();
    check("Giorno 1: Colosseo");
    await screen.findByRole("heading", { level: 2 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/tools/check-plan",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "Giorno 1: Colosseo" }) }),
    ]);
  });

  it.each([
    ["too little in it", 400, { reason: "too_short" }, words.error_too_short],
    ["no plan in it", 400, { reason: "nothing_found" }, words.error_nothing_found],
    ["too many today", 429, {}, words.error_limit],
    ["a failed read", 503, {}, words.error_failed],
    ["a reason it doesn't know", 400, { reason: "other" }, words.error_failed],
  ])("says why for %s", async (_name, status, body, message) => {
    answers(status, body);
    open();
    check();
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("says it failed with no connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    open();
    check();
    expect((await screen.findByRole("alert")).textContent).toBe(words.error_failed);
  });

  it("clears a failure when it tries again", async () => {
    answers(503, {});
    open();
    check();
    await screen.findByRole("alert");
    answers(200, REPORT);
    check();
    await screen.findByRole("heading", { level: 2 });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the report", () => {
  it("names the trip and sums up what it found", async () => {
    answers(200, REPORT);
    open();
    check();
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Il tuo piano per Roma");
    const summary = screen.getByRole("status").textContent;
    expect(summary).toContain("1 giornata sembra troppo piena");
    expect(summary).toContain("Abbiamo cercato 3 locali su Google Maps: 1 chiusi, 1 non trovati");
  });

  it("marks each place by what Maps said, and leaves the others plain", async () => {
    answers(200, REPORT);
    open();
    check();
    await screen.findByRole("heading", { level: 2 });
    const rowOf = (name: string) => screen.getByText(name).closest("li")!;
    expect(within(rowOf("Da Enzo")).getByText(words.open)).toBeTruthy();
    expect(within(rowOf("Chiuso da tempo")).getByText(words.closed)).toBeTruthy();
    expect(within(rowOf("Sconosciuto")).getByText(words.notFound)).toBeTruthy();
    expect(rowOf("Colosseo").textContent).toBe("Colosseo");
  });

  it("marks only the full day, and numbers a day with no name", async () => {
    answers(200, REPORT);
    open();
    check();
    await screen.findByRole("heading", { level: 2 });
    expect(screen.getAllByText(words.packed)).toHaveLength(1);
    expect(screen.getByText("Giorno 2")).toBeTruthy();
  });

  it("says where open and closed come from, once places were looked up", async () => {
    answers(200, REPORT);
    open();
    check();
    expect(await screen.findByText(words.source)).toBeTruthy();
  });

  it("says when the day's searches are used up", async () => {
    answers(200, { ...REPORT, lookedUp: false, looked: 0, closed: 0, missing: 0 });
    open();
    check();
    expect((await screen.findByRole("status")).textContent).toContain(words.noLookups);
    expect(screen.queryByText(words.source)).toBeNull();
  });

  it("says so when there was nothing to look up", async () => {
    answers(200, { ...REPORT, looked: 0, closed: 0, missing: 0 });
    open();
    check();
    expect((await screen.findByRole("status")).textContent).toContain(words.nothingLooked);
  });

  it("does without a place name when the plan has none", async () => {
    answers(200, { ...REPORT, destination: "" });
    open();
    check();
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe(words.report);
  });

  it("records the check, with no words from the plan", async () => {
    answers(200, REPORT);
    open();
    check();
    await screen.findByRole("heading", { level: 2 });
    expect(capture).toHaveBeenCalledWith("plan_checked", { days: 2, looked: 3, closed: 1, missing: 1, packed_days: 1 });
  });

  it("records a failed check", async () => {
    answers(400, { reason: "nothing_found" });
    open();
    check();
    await screen.findByRole("alert");
    expect(capture).toHaveBeenCalledWith("plan_check_failed", { reason: "nothing_found" });
  });
});

describe("fixing it here", () => {
  it("opens the wizard on the trip, with its length and the places worth keeping", async () => {
    answers(200, REPORT);
    open();
    check();
    const link = (await screen.findByRole("link", { name: words.fix })) as HTMLAnchorElement;
    const url = new URL(link.getAttribute("href")!, "https://monkeytravel.app");
    expect(url.pathname).toBe("/trips/new");
    expect(url.searchParams.get("destination")).toBe("Roma");
    expect(url.searchParams.get("days")).toBe("2");
    expect(url.searchParams.getAll("must")).toEqual(["Da Enzo", "Colosseo"]);
    expect(url.searchParams.get("from")).toBe("check");
    fireEvent.click(link);
    expect(capture).toHaveBeenCalledWith("plan_check_fix_clicked", { closed: 1, packed_days: 1 });
  });

  it("leaves out a place it doesn't know", () => {
    const url = new URL(fixHref({ destination: "", keep: [], days: [] }), "https://monkeytravel.app");
    expect(url.searchParams.has("destination")).toBe(false);
  });

  it("keeps names with symbols intact", () => {
    const url = new URL(fixHref({ destination: "São Paulo & co", keep: ["A&B", "C#D"], days: [] }), "https://monkeytravel.app");
    expect(url.searchParams.get("destination")).toBe("São Paulo & co");
    expect(url.searchParams.getAll("must")).toEqual(["A&B", "C#D"]);
  });
});
