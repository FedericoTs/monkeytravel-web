/** @vitest-environment jsdom */
/**
 * "Who's planning this with you?": one co-planner invite per named person. An
 * invite to plan together is the share people accept; a view-only link mostly
 * reaches nobody. Each name gets its own editor link, handed to WhatsApp or the
 * phone's share sheet with a message that names them; a typed email is sent
 * by us instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";

const { captured } = vi.hoisted(() => ({ captured: vi.fn(async () => {}) }));
vi.mock("@/lib/posthog/events", () => ({ captureCoPlannerInviteSent: captured }));

import CoPlannerInvites from "./CoPlannerInvites";

const INVITE_URL = "https://monkeytravel.app/invite/abc123";
const posted: Array<Record<string, unknown>> = [];

function serve(response: { status?: number; body?: unknown } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(response.body ?? { invite: { inviteUrl: INVITE_URL } }), {
        status: response.status ?? 200,
      });
    })
  );
}

function renderInvites(onSent = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <CoPlannerInvites tripId="trip-1" tripTitle="Lisbon Trip" surface="first_day_prompt" onSent={onSent} />
    </NextIntlClientProvider>
  );
  return onSent;
}

const nameField = (n: number) => screen.getByLabelText(`Name of person ${n}`);
const sendButtons = () => screen.getAllByRole("button", { name: "Send" });

beforeEach(() => {
  posted.length = 0;
  captured.mockClear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "share");
});

describe("CoPlannerInvites", () => {
  it("asks who is planning, with a Send per name that waits for a name", () => {
    serve();
    renderInvites();
    expect(screen.getByText("Who's planning this with you?")).toBeTruthy();
    expect(screen.getAllByTestId("coplanner-row")).toHaveLength(2);
    expect((sendButtons()[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameField(1), { target: { value: "Marco" } });
    expect((sendButtons()[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it("makes each named person a co-planner link and hands it to WhatsApp with their name", async () => {
    serve();
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const onSent = renderInvites();
    fireEvent.change(nameField(1), { target: { value: "Marco" } });
    fireEvent.click(sendButtons()[0]);

    await screen.findByText("Sent to Marco");
    expect(posted).toEqual([{ role: "editor" }]);
    const url = new URL(String(open.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://wa.me/");
    const text = url.searchParams.get("text") ?? "";
    expect(text).toContain("Hi Marco!");
    expect(text).toContain("Lisbon Trip");
    expect(text).toContain(INVITE_URL);
    expect(onSent).toHaveBeenCalledWith("whatsapp");
    expect(captured).toHaveBeenCalledWith({ trip_id: "trip-1", channel: "whatsapp", surface: "first_day_prompt" });
  });

  it("uses the phone's share sheet where there is one", async () => {
    serve();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({ matches: q.includes("coarse"), media: q, addEventListener() {}, removeEventListener() {} }),
    });
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    renderInvites();
    fireEvent.change(nameField(1), { target: { value: "Sofia" } });
    fireEvent.click(sendButtons()[0]);

    await screen.findByText("Sent to Sofia");
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining(INVITE_URL) });
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ channel: "native" }));
  });

  it("emails the invite when an address is typed", async () => {
    serve({ body: { invite: { inviteUrl: INVITE_URL }, emailOutcome: "sent" } });
    const open = vi.spyOn(window, "open");
    renderInvites();
    fireEvent.change(nameField(1), { target: { value: "Bea" } });
    fireEvent.click(screen.getAllByText("Send by email instead")[0]);
    fireEvent.change(screen.getByLabelText("Email of person 1"), { target: { value: "bea@example.com" } });
    fireEvent.click(sendButtons()[0]);

    await screen.findByText("Emailed Bea");
    expect(posted).toEqual([{ role: "editor", recipientEmail: "bea@example.com" }]);
    expect(open).not.toHaveBeenCalled();
  });

  it("offers WhatsApp and copy when the window was blocked or the email could not go", async () => {
    serve({ body: { invite: { inviteUrl: INVITE_URL }, emailOutcome: "failed" } });
    renderInvites();
    fireEvent.change(nameField(1), { target: { value: "Bea" } });
    fireEvent.click(screen.getAllByText("Send by email instead")[0]);
    fireEvent.change(screen.getByLabelText("Email of person 1"), { target: { value: "bea@example.com" } });
    fireEvent.click(sendButtons()[0]);

    const whatsapp = await screen.findByRole("button", { name: "WhatsApp" });
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(whatsapp);
    await screen.findByText("Sent to Bea");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("says so when the invite cannot be made", async () => {
    serve({ status: 500, body: { error: "nope" } });
    renderInvites();
    fireEvent.change(nameField(1), { target: { value: "Marco" } });
    fireEvent.click(sendButtons()[0]);
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
    expect(captured).not.toHaveBeenCalled();
  });

  it("adds people up to eight", async () => {
    serve();
    renderInvites();
    for (let i = 0; i < 10; i++) {
      const add = screen.queryByText("Add someone");
      if (add) fireEvent.click(add);
    }
    await waitFor(() => expect(screen.getAllByTestId("coplanner-row")).toHaveLength(8));
    expect(screen.queryByText("Add someone")).toBeNull();
  });
});
