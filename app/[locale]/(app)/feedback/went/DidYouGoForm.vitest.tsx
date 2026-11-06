import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import DidYouGoForm from "./DidYouGoForm";

const TOKEN = "abc.def";
const fetchMock = vi.fn();
const posted = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
const answers = (...results: boolean[]) => {
  for (const saved of results) {
    fetchMock.mockResolvedValueOnce({ ok: saved, json: async () => (saved ? { saved: true } : {}) });
  }
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("landing from the return email", () => {
  it("saves the answer as it opens, once", async () => {
    answers(true);
    render(<DidYouGoForm token={TOKEN} answer="yes" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/feedback");
    expect(posted()).toEqual([{ token: TOKEN, went: "yes" }]);
    expect(screen.getByRole("heading").textContent).toBe("yesTitle");
    expect(screen.getByText("noted")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks what went wrong after going, with that answer's reasons", async () => {
    answers(true);
    render(<DidYouGoForm token={TOKEN} answer="yes" />);
    expect(screen.getByText("yesQuestion")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "reason_none",
      "reason_closed",
      "reason_packed",
      "reason_times",
      "reason_other",
    ]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("asks what got in the way after not going, with that answer's reasons", async () => {
    answers(true);
    render(<DidYouGoForm token={TOKEN} answer="no" />);
    expect(screen.getByRole("heading").textContent).toBe("noTitle");
    expect(screen.getByText("noQuestion")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "reason_changed",
      "reason_elsewhere",
      "reason_later",
      "reason_plan",
      "reason_other",
    ]);
    await waitFor(() => expect(posted()).toEqual([{ token: TOKEN, went: "no" }]));
  });

  it("says so when the answer didn't save, and tries again on request", async () => {
    answers(false, true);
    render(<DidYouGoForm token={TOKEN} answer="yes" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("error"));
    expect(screen.queryByText("noted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("noted")).toBeTruthy();
    expect(posted()).toEqual([
      { token: TOKEN, went: "yes" },
      { token: TOKEN, went: "yes" },
    ]);
  });

  it("treats an answer the server didn't keep as not saved", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ saved: false }) });
    render(<DidYouGoForm token={TOKEN} answer="yes" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("treats a network failure as not saved", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<DidYouGoForm token={TOKEN} answer="yes" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});

describe("saying what went wrong", () => {
  const send = () => screen.getByRole("button", { name: "send" }) as HTMLButtonElement;

  it("has nothing to send until there's a reason or a note", async () => {
    answers(true);
    render(<DidYouGoForm token={TOKEN} answer="yes" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "too far" } });
    expect(send().disabled).toBe(false);
  });

  it("sends the answer, the reason and the note, then thanks them", async () => {
    answers(true, true);
    render(<DidYouGoForm token={TOKEN} answer="yes" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const closed = screen.getByRole("radio", { name: "reason_closed" });
    fireEvent.click(closed);
    expect(closed.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "reason_none" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "the museum" } });
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("thanksTitle"));
    expect(posted()[1]).toEqual({ token: TOKEN, went: "yes", went_reason: "closed", went_note: "the museum" });
    expect(screen.getByRole("link", { name: "nextTrip" }).getAttribute("href")).toBe("/trips/new");
    expect(screen.getByRole("link", { name: "moreLink" }).getAttribute("href")).toBe(`/feedback/${TOKEN}`);
  });

  it("keeps what they wrote and says so when it didn't save", async () => {
    answers(true, false);
    render(<DidYouGoForm token={TOKEN} answer="no" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("radio", { name: "reason_later" }));
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("error"));
    expect(screen.getByRole("radio", { name: "reason_later" }).getAttribute("aria-checked")).toBe("true");
    expect(send().disabled).toBe(false);
  });
});
