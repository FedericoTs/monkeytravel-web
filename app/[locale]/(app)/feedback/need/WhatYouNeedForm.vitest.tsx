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

import WhatYouNeedForm from "./WhatYouNeedForm";

const TOKEN = "abc.def";
const fetchMock = vi.fn();
const posted = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
const answers = (...results: boolean[]) => {
  for (const saved of results) {
    fetchMock.mockResolvedValueOnce({ ok: saved, json: async () => (saved ? { saved: true } : {}) });
  }
};
const open = () => render(<WhatYouNeedForm token={TOKEN} need="stay" answerLabel="Where to stay" />);
const send = () => screen.getByRole("button", { name: "send" });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("landing from a reminder's one question", () => {
  it("saves the answer as it opens, once, and says what was noted", async () => {
    answers(true);
    open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/feedback");
    expect(posted()).toEqual([{ token: TOKEN, need: "stay" }]);
    expect(screen.getByRole("heading").textContent).toBe("heading");
    expect(screen.getByText("Where to stay")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when the answer didn't save, and tries again on request", async () => {
    answers(false, true);
    open();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("error");
    fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(posted()[1]).toEqual({ token: TOKEN, need: "stay" });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("treats a network failure as not saved", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    open();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("adding a note, or a yes to writing back", () => {
  it("has nothing to send until there's a note or the tick", async () => {
    answers(true);
    open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((send() as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the answer, the note and the tick, then thanks them", async () => {
    answers(true, true);
    open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A place near the station" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send());
    await screen.findByText("thanksTitle");
    expect(posted()[1]).toEqual({ token: TOKEN, need: "stay", need_note: "A place near the station", open_to_chat: true });
    expect(screen.getByText("thanksBody")).toBeTruthy();
  });

  it("sends a note without a yes to writing back", async () => {
    answers(true, true);
    open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Trains" } });
    fireEvent.click(send());
    await screen.findByText("thanksTitle");
    expect(posted()[1]).toEqual({ token: TOKEN, need: "stay", need_note: "Trains", open_to_chat: false });
  });

  it("keeps what they wrote and says so when it didn't save", async () => {
    answers(true, false);
    open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Trains" } });
    fireEvent.click(send());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Trains");
    expect(screen.queryByText("thanksTitle")).toBeNull();
  });
});
