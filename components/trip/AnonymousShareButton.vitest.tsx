/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import AnonymousShareButton from "./AnonymousShareButton";

/**
 * The signed-out share on the wizard's result: once the link exists it leaves
 * with a message, through the phone's share sheet or WhatsApp, instead of
 * waiting in the clipboard as a bare URL. A crew ask keeps its vote marker.
 */

const SHARE_URL = "https://monkeytravel.app/shared/11111111-2222-4333-8444-555555555555";
const copy = enTrips.wizard.result;

const events = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>>, copied: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/posthog/events", () => ({
  captureAnonShareClicked: async () => {},
  captureAnonShareCreated: async () => {},
  captureAnonShareFailed: async () => {},
  captureAnonShareKeepClicked: async () => {},
  captureAnonShareCopied: async (e: Record<string, unknown>) => {
    events.copied.push(e);
  },
  captureAnonShareSent: async (e: Record<string, unknown>) => {
    events.sent.push(e);
  },
}));
vi.mock("@/lib/trips/anonymous-claim-client", () => ({
  shareAnonymousTrip: async () => ({ shareUrl: SHARE_URL, tripId: "trip-1", claimToken: "claim-1", expiresAt: "2099-01-01T00:00:00Z" }),
  buildPendingClaim: () => ({}),
}));

const trip = {
  title: "Lisbon Trip",
  destination: "Lisbon",
  startDate: "2026-11-12",
  endDate: "2026-11-14",
  itinerary: [{ day_number: 1 }, { day_number: 2 }, { day_number: 3 }],
};

const clipboard = { writeText: vi.fn(async () => {}) };

function asPhone(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: q === "(pointer: coarse)", media: q, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn(share) });
}

function renderButton(mode: "crew" | "share" = "crew", emphasis?: "primary" | "secondary") {
  render(
    <NextIntlClientProvider locale="en" messages={{ trips: enTrips }}>
      <AnonymousShareButton trip={trip} mode={mode} emphasis={emphasis} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  events.sent.length = 0;
  events.copied.length = 0;
  clipboard.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
  Reflect.deleteProperty(navigator, "share");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tallies: {} }))));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AnonymousShareButton", () => {
  it("on a phone, hands the new link to the share sheet with a message asking for votes", async () => {
    asPhone(async () => {});
    renderButton("crew");
    fireEvent.click(screen.getByRole("button", { name: copy.shareCrewCta }));
    await waitFor(() => expect(events.sent).toHaveLength(1));
    const message = vi.mocked(navigator.share).mock.calls[0][0]?.text;
    expect(message).toBe(`I planned our trip to Lisbon. Vote on what we should do, no account needed: ${SHARE_URL}?vote=1`);
    expect(events.sent[0]).toMatchObject({ channel: "native", destination: "Lisbon", duration_days: 3 });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("elsewhere, copies the link with its vote marker and sends it on WhatsApp in one tap", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    renderButton("crew");
    fireEvent.click(screen.getByRole("button", { name: copy.shareCrewCta }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(`${SHARE_URL}?vote=1`));
    expect(screen.queryByRole("button", { name: copy.shareSendNative })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.shareSendWhatsapp }));
    const text = new URL(String(open.mock.calls[0][0])).searchParams.get("text");
    expect(text).toBe(`I planned our trip to Lisbon. Vote on what we should do, no account needed: ${SHARE_URL}?vote=1`);
    expect(events.sent).toEqual([expect.objectContaining({ channel: "whatsapp" })]);
  });

  it("keeps the buttons when the share sheet refuses, so a fresh tap can send it", async () => {
    asPhone(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    renderButton("share");
    fireEvent.click(screen.getByRole("button", { name: copy.shareAnonCta }));
    expect(await screen.findByRole("button", { name: copy.shareSendWhatsapp })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.shareSendNative })).toBeTruthy();
    expect(events.sent).toEqual([]);
  });

  it("does not count a WhatsApp window the browser blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    renderButton("share");
    fireEvent.click(screen.getByRole("button", { name: copy.shareAnonCta }));
    fireEvent.click(await screen.findByRole("button", { name: copy.shareSendWhatsapp }));
    expect(events.sent).toEqual([]);
  });

  it("can be the main button, as the crew-first result asks", () => {
    renderButton("crew", "primary");
    expect(screen.getByRole("button", { name: copy.shareCrewCta }).className).toContain("bg-[var(--secondary-ink)]");
    cleanup();
    renderButton("crew");
    expect(screen.getByRole("button", { name: copy.shareCrewCta }).className).toContain("bg-white");
  });
});
