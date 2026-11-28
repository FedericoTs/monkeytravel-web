/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
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
  captureStoryWayInOpened: async () => {},
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

function renderButton(mode: "crew" | "share" = "crew", more: Partial<React.ComponentProps<typeof AnonymousShareButton>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ trips: enTrips, common: enCommon }}>
      <AnonymousShareButton trip={trip} mode={mode} {...more} />
    </NextIntlClientProvider>,
  );
}
/** The panel a bar's button opens, when it is open. */
const panelOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-share-panel]");

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
  // The story_way_in draw stays out of the way unless a test asks for it.
  window.localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_EXP_STORY_WAY_IN", "off");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
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

  it("with room for them, shows the link's controls in the button's place", async () => {
    const { container } = renderButton("share");
    fireEvent.click(screen.getByRole("button", { name: copy.shareAnonCta }));
    expect(await screen.findByDisplayValue(SHARE_URL)).toBeTruthy();
    expect(screen.queryByRole("button", { name: copy.shareAnonCta })).toBeNull();
    expect(panelOf(container)).toBeNull();
  });
});

// In the header and the phone's bottom bar the link's controls would take the bar's room.
describe("AnonymousShareButton in a bar", () => {
  const trigger = (name: string = copy.shareAnonCta) => screen.getByRole("button", { name });

  it("on a computer, copies the link and says so in a panel under the button, which stays", async () => {
    const { container } = renderButton("share", { panel: "below", onKeep: () => {} });
    fireEvent.click(trigger());
    await waitFor(() => expect(panelOf(container)).not.toBeNull());
    expect(clipboard.writeText).toHaveBeenCalledWith(SHARE_URL);
    const panel = panelOf(container)!;
    // Over the page, not in the bar's row.
    expect(panel.className).toContain("absolute");
    expect(panel.className).toContain("top-full");
    expect(panel.getAttribute("data-share-panel")).toBe("below");
    expect(panel.querySelector('[role="status"]')?.textContent).toBe(copy.shareAnonCopiedLine);
    expect(screen.getByDisplayValue(SHARE_URL)).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.shareSendWhatsapp })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.shareAnonKeepCta })).toBeTruthy();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(panel.id);
  });

  it("closes on its close button, on Escape, on a press elsewhere and on the button, and opens again without the copied line", async () => {
    const { container } = renderButton("share", { panel: "below" });
    fireEvent.click(trigger());
    await waitFor(() => expect(panelOf(container)).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: enCommon.buttons.close }));
    expect(panelOf(container)).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger());
    // Nothing was copied this time: the panel is named, with no claim.
    expect(panelOf(container)!.querySelector('[role="status"]')?.textContent).toBe(copy.shareAnonCta);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panelOf(container)).toBeNull();

    fireEvent.click(trigger());
    fireEvent.pointerDown(panelOf(container)!);
    expect(panelOf(container)).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(panelOf(container)).toBeNull();

    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(panelOf(container)).toBeNull();
    // One link for all of it.
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("opens with no copied line when the browser kept the clipboard shut", async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error("blocked"));
    const { container } = renderButton("share", { panel: "below" });
    fireEvent.click(trigger());
    await waitFor(() => expect(panelOf(container)).not.toBeNull());
    expect(panelOf(container)!.querySelector('[role="status"]')?.textContent).toBe(copy.shareAnonCta);
    expect(events.copied).toEqual([]);
  });

  it("on a phone, the share sheet is all there is: the bar stays as it was", async () => {
    asPhone(async () => {});
    const { container } = renderButton("share", { panel: "above" });
    fireEvent.click(trigger());
    await waitFor(() => expect(events.sent).toHaveLength(1));
    expect(panelOf(container)).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    // The button then opens the rest, over the bar.
    fireEvent.click(trigger());
    const panel = panelOf(container)!;
    expect(panel.className).toContain("bottom-full");
    expect(panel.querySelector('[role="status"]')?.textContent).toBe(copy.shareAnonCta);
    // Sending from the panel gives the screen back.
    fireEvent.click(screen.getByRole("button", { name: copy.shareSendNative }));
    await waitFor(() => expect(events.sent).toHaveLength(2));
    await waitFor(() => expect(panelOf(container)).toBeNull());
  });

  it("stays open when the person closes a share sheet opened from the panel", async () => {
    let asked = 0;
    asPhone(async () => {
      asked++;
      if (asked > 1) throw new DOMException("closed", "AbortError");
    });
    const { container } = renderButton("share", { panel: "above" });
    fireEvent.click(trigger());
    await waitFor(() => expect(events.sent).toHaveLength(1));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: copy.shareSendNative }));
    await waitFor(() => expect(asked).toBe(2));
    await new Promise((settled) => setTimeout(settled, 0));
    // Nothing was sent: the buttons are still there.
    expect(panelOf(container)).not.toBeNull();
    expect(events.sent).toHaveLength(1);
  });

  it("stays shut when the person closes the share sheet themselves", async () => {
    let asked = 0;
    asPhone(async () => {
      asked++;
      throw new DOMException("closed", "AbortError");
    });
    const { container } = renderButton("share", { panel: "above" });
    fireEvent.click(trigger());
    await waitFor(() => expect(asked).toBe(1));
    await waitFor(() => expect(trigger().getAttribute("aria-expanded")).toBe("false"));
    expect(panelOf(container)).toBeNull();
    expect(events.sent).toEqual([]);
  });

  it("opens when the phone refuses its share sheet, with buttons for a fresh tap", async () => {
    asPhone(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    const { container } = renderButton("share", { panel: "above" });
    fireEvent.click(trigger());
    await waitFor(() => expect(panelOf(container)).not.toBeNull());
    expect(screen.getByRole("button", { name: copy.shareSendNative })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.shareSendWhatsapp })).toBeTruthy();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("closes after WhatsApp opened, and stays when the browser blocked it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = renderButton("share", { panel: "below" });
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("button", { name: copy.shareSendWhatsapp }));
    expect(panelOf(container)).not.toBeNull();
    open.mockReturnValue({} as Window);
    fireEvent.click(screen.getByRole("button", { name: copy.shareSendWhatsapp }));
    expect(panelOf(container)).toBeNull();
    expect(events.sent).toEqual([expect.objectContaining({ channel: "whatsapp" })]);
  });

  it("closes on the way to keeping the trip", async () => {
    const onKeep = vi.fn();
    const { container } = renderButton("share", { panel: "below", onKeep });
    fireEvent.click(trigger());
    await waitFor(() => expect(panelOf(container)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: copy.shareAnonKeepCta }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(panelOf(container)).toBeNull();
  });

  it("starts shut on a link another button made, and shows the crew's votes on the button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tallies: { a: { up: 2, down: 1 } } }))));
    const { container } = renderButton("crew", { panel: "above", existingShareUrl: SHARE_URL });
    expect(panelOf(container)).toBeNull();
    const button = screen.getByRole("button", { name: new RegExp(copy.shareCrewCta) });
    await waitFor(() => expect(button.textContent).toContain("3"));
    fireEvent.click(button);
    expect(screen.getByDisplayValue(`${SHARE_URL}?vote=1`)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(`${SHARE_URL}?vote=1`);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
});

