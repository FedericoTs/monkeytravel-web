/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import enCommon from "@/messages/en/common.json";
import SendDayToGroup from "./SendDayToGroup";

/**
 * "Send to the group" on the signed day page: the share link is fetched on
 * the tap with the day's send key, and the day's plan leaves with it through
 * the phone's share sheet, WhatsApp, or the clipboard.
 */

const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const URL_SENT = "https://monkeytravel.app/shared/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d?ref=OWNERCODE&day=3";
const PREFIX = "Lisbon, day 3 (Fri, Oct 16) · Alfama\n09:00 · Tram 28\n\nThe whole plan: ";
const labels = enCommon.tripDayPage.send;

const events = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/posthog/events", () => ({
  captureDayPlanSent: async (e: Record<string, unknown>) => {
    events.sent.push(e);
  },
}));

const clipboard = { writeText: vi.fn(async () => {}) };
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: URL_SENT, isNew: true })));

function asPhone(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: q === "(pointer: coarse)", media: q, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn(share) });
}

function renderPanel() {
  render(
    <SendDayToGroup
      tripId={TRIP}
      date="2026-10-16"
      dayNumber={3}
      sendKey="1797000000.send-key"
      messagePrefix={PREFIX}
      labels={{
        title: labels.title,
        body: labels.body,
        cta: labels.cta,
        sending: labels.sending,
        whatsapp: labels.whatsapp,
        share: labels.share,
        copy: labels.copy,
        copied: labels.copied,
        error: labels.error,
      }}
    />,
  );
}

beforeEach(() => {
  events.sent.length = 0;
  clipboard.writeText.mockClear();
  fetchMock.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
  Reflect.deleteProperty(navigator, "share");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SendDayToGroup", () => {
  it("asks for nothing until the tap, then sends the send key", async () => {
    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: labels.cta }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(`/api/day/${TRIP}/2026-10-16/share`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ s: "1797000000.send-key" });
  });

  it("on a phone, hands the day's plan and the link to the share sheet", async () => {
    asPhone(async () => {});
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: labels.cta }));
    await waitFor(() => expect(events.sent).toHaveLength(1));
    expect(vi.mocked(navigator.share).mock.calls[0][0]?.text).toBe(`${PREFIX}${URL_SENT}`);
    expect(events.sent[0]).toEqual({ trip_id: TRIP, day: 3, channel: "native" });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("elsewhere, copies the message and sends it on WhatsApp in one more tap", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: labels.cta }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(`${PREFIX}${URL_SENT}`));
    expect(screen.queryByRole("button", { name: labels.share })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: labels.whatsapp }));
    const text = new URL(String(open.mock.calls[0][0])).searchParams.get("text");
    expect(text).toBe(`${PREFIX}${URL_SENT}`);
    expect(events.sent.map((e) => e.channel)).toEqual(["copy", "whatsapp"]);
  });

  it("keeps the buttons when the share sheet refuses, so a fresh tap can send it", async () => {
    asPhone(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: labels.cta }));
    expect(await screen.findByRole("button", { name: labels.whatsapp })).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.share })).toBeTruthy();
    expect(events.sent).toEqual([]);
  });

  it("says so when the link can't be had, and lets the tap be tried again", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 410 }));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: labels.cta }));
    expect((await screen.findByRole("alert")).textContent).toBe(labels.error);
    fireEvent.click(screen.getByRole("button", { name: labels.cta }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
  });
});
