/** @vitest-environment jsdom */
/**
 * The share window's link tab and its frame, through the window: turning the link
 * on and off, copying it, sending it, the trip as a picture, and what the window
 * does on a phone and on a desktop. Which link is offered and the Explore switch
 * are in ShareAndInviteModal.vitest.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import en from "@/messages/en/common.json";
import ShareAndInviteModal from "./ShareAndInviteModal";

const shareFile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/native/share", () => ({ shareFile }));
const captureTripCardShared = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posthog/events", () => ({ captureTripCardShared }));
const analytics = vi.hoisted(() => ({
  trackShareModalOpened: vi.fn(),
  trackTripShared: vi.fn(),
  trackReferralLinkClicked: vi.fn(),
}));
vi.mock("@/lib/analytics", () => analytics);
const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
const openExternal = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/native/external-link", () => ({ openExternal }));
vi.mock("@/components/trip/CoPlannerInvites", () => ({ default: () => <div>co-planners</div> }));
const phone = vi.hoisted(() => ({ is: false }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsPhone: () => phone.is }));
vi.mock("@/components/ui/BottomSheet", () => ({
  default: (p: { title: string; onClose: () => void; children: ReactNode }) => (
    <div data-testid="sheet">
      <h2>{p.title}</h2>
      <button onClick={p.onClose}>close the sheet</button>
      {p.children}
    </div>
  ),
}));

const TOKEN = "11111111-2222-3333-4444-555555555555";
const SHARE_URL = `https://monkeytravel.app/shared/${TOKEN}?ref=ABC123`;
const CREW_URL = `${SHARE_URL}&vote=1`;

type Props = ComponentProps<typeof ShareAndInviteModal>;
const defaults = (): Props => ({
  isOpen: true,
  onClose: vi.fn(),
  tripId: "trip-1",
  tripTitle: "Lisbon: à la carte!",
  shareUrl: SHARE_URL,
  isShared: true,
  onStopSharing: vi.fn(),
  onEnableSharing: vi.fn(async () => undefined),
  isLoading: false,
});
const windowWith = (props: Props) => (
  <NextIntlClientProvider locale="en" messages={{ common: en }}>
    <ShareAndInviteModal {...props} />
  </NextIntlClientProvider>
);
function show(over: Partial<Props> = {}) {
  const props = { ...defaults(), ...over };
  return { props, view: render(windowWith(props)) };
}
const settled = () => act(async () => {});
const fill = (message: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), message);

const copyButton = () => screen.getByRole("button", { name: en.buttons.copy });
const whatsApp = () => screen.getByRole("button", { name: en.share.a11y.whatsapp });
const twitter = () => screen.getByRole("button", { name: en.share.a11y.twitter });
const email = () => screen.getByRole("button", { name: en.share.a11y.email });
const inviteTab = () => screen.getByRole("button", { name: new RegExp(en.share.invite.inviteToCollaborate) });
const linkTab = () => screen.getByRole("button", { name: new RegExp(en.share.invite.viewOnlyLink) });

beforeEach(() => {
  phone.is = false;
  shareFile.mockResolvedValue("downloaded");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ collaborators: [], invites: [] }),
      blob: async () => new Blob(["png"], { type: "image/png" }),
    }))
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("a trip whose link isn't on", () => {
  it("the owner can turn it on, and nothing to send shows yet", async () => {
    const { props } = show({ isShared: false });
    await settled();
    fireEvent.click(screen.getByRole("button", { name: en.share.invite.enableSharingButton }));
    expect(props.onEnableSharing).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: en.share.a11y.whatsapp })).toBeNull();
    expect(screen.queryByLabelText(en.share.invite.publicLink)).toBeNull();
  });

  it("the button says it's working and locks while it does", async () => {
    show({ isShared: false, isLoading: true });
    await settled();
    expect((screen.getByRole("button", { name: en.share.invite.enabling }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("a trip whose link is on", () => {
  it("doesn't offer to turn it on again", async () => {
    show();
    await settled();
    expect(screen.queryByRole("button", { name: en.share.invite.enableSharingButton })).toBeNull();
  });
});

describe("copying the link", () => {
  const clipboard = (writeText: () => Promise<void>) => vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

  it("says so, reports it, and shows Copied for a moment", async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    show();
    await settled();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(writeText).toHaveBeenCalledWith(SHARE_URL);
    expect(addToast).toHaveBeenCalledExactlyOnceWith(en.share.toast.viewOnlyCopied, "success");
    expect(analytics.trackTripShared).toHaveBeenCalledWith({ tripId: "trip-1", shareMethod: "link" });
    expect(analytics.trackReferralLinkClicked).toHaveBeenCalledWith({ code: "trip-1", medium: "copy" });
    expect(screen.getByRole("button", { name: en.buttons.copied })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(copyButton()).toBeTruthy();
  });

  it("says when it couldn't, and reports nothing", async () => {
    clipboard(vi.fn(async () => Promise.reject(new Error("denied"))));
    show();
    await settled();
    fireEvent.click(copyButton());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.copyFailed, "error"));
    expect(analytics.trackTripShared).not.toHaveBeenCalled();
    expect(copyButton()).toBeTruthy();
  });
});

describe("sending the link", () => {
  const crew = { tripIntent: "group" as const };
  const opened = () => decodeURIComponent(String((openExternal.mock.calls as unknown as string[][])[0][0]));

  it("to WhatsApp, with the plain words and the link", async () => {
    show();
    await settled();
    fireEvent.click(whatsApp());
    const text = fill(en.share.socialText.whatsappShare, { tripTitle: "Lisbon: à la carte!" });
    expect(opened()).toBe(`https://wa.me/?text=${text}\n${SHARE_URL}`);
    expect(analytics.trackTripShared).toHaveBeenCalledExactlyOnceWith({ tripId: "trip-1", shareMethod: "social" });
  });

  it("to WhatsApp, as the crew ask with the crew link", async () => {
    show(crew);
    await settled();
    fireEvent.click(whatsApp());
    const text = fill(en.share.socialText.whatsappCrew, { tripTitle: "Lisbon: à la carte!" });
    expect(opened()).toBe(`https://wa.me/?text=${text}\n${CREW_URL}`);
  });

  it("to Twitter, with the plain words and the link", async () => {
    show();
    await settled();
    fireEvent.click(twitter());
    const text = fill(en.share.socialText.twitterShare, { tripTitle: "Lisbon: à la carte!" });
    expect(opened()).toBe(`https://twitter.com/intent/tweet?text=${text}&url=${SHARE_URL}`);
    expect(analytics.trackTripShared).toHaveBeenCalledExactlyOnceWith({ tripId: "trip-1", shareMethod: "social" });
  });

  it("to Twitter, as the crew ask with the crew link", async () => {
    show(crew);
    await settled();
    fireEvent.click(twitter());
    const text = fill(en.share.socialText.twitterCrew, { tripTitle: "Lisbon: à la carte!" });
    expect(opened()).toBe(`https://twitter.com/intent/tweet?text=${text}&url=${CREW_URL}`);
  });

  describe("by email", () => {
    const realLocation = window.location;
    let goneTo = "";
    beforeEach(() => {
      goneTo = "";
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          ...realLocation,
          set href(url: string) {
            goneTo = url;
          },
        },
      });
    });
    afterEach(() => {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    });

    it("with the plain words and the link", async () => {
      show();
      await settled();
      fireEvent.click(email());
      const subject = fill(en.share.socialText.emailSubject, { tripTitle: "Lisbon: à la carte!" });
      expect(decodeURIComponent(goneTo)).toBe(`mailto:?subject=${subject}&body=${en.share.socialText.emailBody}\n\n${SHARE_URL}`);
      expect(analytics.trackTripShared).toHaveBeenCalledExactlyOnceWith({ tripId: "trip-1", shareMethod: "email" });
    });

    it("as the crew ask with the crew link", async () => {
      show(crew);
      await settled();
      fireEvent.click(email());
      const subject = fill(en.share.socialText.emailSubjectCrew, { tripTitle: "Lisbon: à la carte!" });
      expect(decodeURIComponent(goneTo)).toBe(`mailto:?subject=${subject}&body=${en.share.socialText.emailBodyCrew}\n\n${CREW_URL}`);
    });
  });
});

describe("the trip as a picture", () => {
  const story = () => screen.getByTestId("share-image-story");
  const square = () => screen.getByTestId("share-image-square");
  const funnelPosts = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/funnel-event");

  it("names the file from the trip's title, and reports where it went", async () => {
    show();
    await settled();
    fireEvent.click(square());
    await waitFor(() => expect(shareFile).toHaveBeenCalled());
    const [file, options] = shareFile.mock.calls[0] as [File, { title: string }];
    expect(file.name).toBe("lisbon-à-la-carte-square.png");
    expect(file.type).toBe("image/png");
    expect(options).toEqual({ title: "Lisbon: à la carte!" });
    await waitFor(() => expect(funnelPosts()).toHaveLength(1));
    expect(JSON.parse(String(funnelPosts()[0][1]?.body))).toEqual({
      event_type: "trip_card_shared",
      trip_id: "trip-1",
      format: "square",
      method: "download",
    });
    expect(captureTripCardShared).toHaveBeenCalledWith({ trip_id: "trip-1", format: "square", method: "download" });
    expect(analytics.trackTripShared).toHaveBeenCalledWith({ tripId: "trip-1", shareMethod: "image" });
  });

  it("calls it a native share when the phone's sheet took it", async () => {
    shareFile.mockResolvedValue("shared");
    show();
    await settled();
    fireEvent.click(story());
    await waitFor(() => expect(captureTripCardShared).toHaveBeenCalledWith({ trip_id: "trip-1", format: "story", method: "native_share" }));
  });

  it("falls back to a plain name for a title with no letters", async () => {
    show({ tripTitle: "!!!" });
    await settled();
    fireEvent.click(story());
    await waitFor(() => expect(shareFile).toHaveBeenCalled());
    expect((shareFile.mock.calls[0] as [File])[0].name).toBe("trip-story.png");
  });

  it("reports nothing when the sheet was cancelled, and frees the buttons", async () => {
    shareFile.mockResolvedValue("cancelled");
    show();
    await settled();
    fireEvent.click(story());
    await waitFor(() => expect(shareFile).toHaveBeenCalled());
    await settled();
    expect(captureTripCardShared).not.toHaveBeenCalled();
    expect(analytics.trackTripShared).not.toHaveBeenCalled();
    expect(funnelPosts()).toHaveLength(0);
    expect((story() as HTMLButtonElement).disabled).toBe(false);
  });

  it("says when the picture couldn't be made, and frees the buttons", async () => {
    vi.mocked(fetch).mockImplementation((async (url: string) =>
      String(url).includes("/api/og/") ? { ok: false, status: 500, blob: async () => new Blob(["an error page"]) } : { ok: true, status: 200, json: async () => ({ collaborators: [] }) }) as never);
    show();
    await settled();
    fireEvent.click(story());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.image.failed, "error"));
    expect(shareFile).not.toHaveBeenCalled();
    expect((story() as HTMLButtonElement).disabled).toBe(false);
  });

  it("isn't offered for a link with no token to draw it from", async () => {
    show({ shareUrl: "https://monkeytravel.app/trip/lisbon" });
    await settled();
    expect(screen.queryByTestId("share-image-story")).toBeNull();
    expect(screen.queryByText(en.share.image.label)).toBeNull();
  });

  it("says it's preparing, and locks both while it does", async () => {
    let finish = (_: string) => {};
    shareFile.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show();
    await settled();
    fireEvent.click(story());
    await waitFor(() => expect(story().textContent).toContain(en.share.image.preparing));
    expect((story() as HTMLButtonElement).disabled).toBe(true);
    expect((square() as HTMLButtonElement).disabled).toBe(true);
    expect(square().textContent).toContain(en.share.image.square);
    await act(async () => finish("downloaded"));
    await waitFor(() => expect((story() as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("taking the trip off Explore", () => {
  const answering = (answer: () => Promise<unknown>) =>
    vi.mocked(fetch).mockImplementation((async (url: string, init?: RequestInit) =>
      String(url).endsWith("/publish") && init?.method === "DELETE"
        ? answer()
        : { ok: true, status: 200, json: async () => ({ collaborators: [] }) }) as never);

  it("tells the page once it's done", async () => {
    const onTrendingChange = vi.fn();
    show({ isInTrending: true, onTrendingChange });
    await settled();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(onTrendingChange).toHaveBeenCalledExactlyOnceWith(false));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it.each([
    ["it's refused", async () => ({ ok: false, status: 500 })],
    ["the connection drops", async () => Promise.reject(new TypeError("Load failed"))],
  ])("says so when %s, stays listed, and can be tried again", async (_name, answer) => {
    answering(answer);
    const onTrendingChange = vi.fn();
    show({ isInTrending: true, onTrendingChange });
    await settled();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.explore.unlistFailed, "error"));
    expect(onTrendingChange).not.toHaveBeenCalled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("stopping the link", () => {
  const stop = () => screen.getByRole("button", { name: en.share.stopSharing.button });

  it("asks first, and cancelling changes nothing", async () => {
    const { props } = show();
    await settled();
    fireEvent.click(stop());
    expect(screen.getByText(en.share.stopSharing.confirmMessage)).toBeTruthy();
    expect(props.onStopSharing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: en.buttons.cancel }));
    expect(screen.queryByText(en.share.stopSharing.confirmMessage)).toBeNull();
    expect(stop()).toBeTruthy();
  });

  it("stops it once confirmed", async () => {
    const { props } = show();
    await settled();
    fireEvent.click(stop());
    fireEvent.click(screen.getByRole("button", { name: en.share.stopSharing.stop }));
    expect(props.onStopSharing).toHaveBeenCalledTimes(1);
  });

  it("locks and says it's stopping while it does", async () => {
    show({ isLoading: true });
    await settled();
    fireEvent.click(stop());
    expect((screen.getByRole("button", { name: en.share.stopSharing.stopping }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the tabs", () => {
  it("open where they're asked to, and move either way", async () => {
    show({ initialTab: "invite" });
    await settled();
    expect(screen.getByText("co-planners")).toBeTruthy();
    expect(screen.queryByLabelText(en.share.invite.publicLink)).toBeNull();
    fireEvent.click(linkTab());
    expect(screen.queryByText("co-planners")).toBeNull();
    expect(screen.getByLabelText(en.share.invite.publicLink)).toBeTruthy();
    fireEvent.click(inviteTab());
    expect(screen.getByText("co-planners")).toBeTruthy();
  });

  it("open on the link by default", async () => {
    show();
    await settled();
    expect(screen.getByLabelText(en.share.invite.publicLink)).toBeTruthy();
  });
});

describe("opening the window again", () => {
  it("goes back to its first tab, and forgets a half-made stop, but keeps the chosen framing", async () => {
    const { props, view } = show();
    await settled();
    fireEvent.click(screen.getByTestId("share-framing-crew"));
    fireEvent.click(screen.getByRole("button", { name: en.share.stopSharing.button }));
    fireEvent.click(inviteTab());
    view.rerender(windowWith({ ...props, isOpen: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(windowWith({ ...props, isOpen: true }));
    await settled();
    expect(screen.getByLabelText(en.share.invite.publicLink)).toBeTruthy();
    expect(screen.queryByText(en.share.stopSharing.confirmMessage)).toBeNull();
    expect(screen.getByTestId("share-framing-crew").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText(en.share.invite.publicLink) as HTMLInputElement).value).toBe(CREW_URL);
  });

  it("reads the Explore listing afresh", async () => {
    const { props, view } = show({ isInTrending: false });
    await settled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    view.rerender(windowWith({ ...props, isOpen: false, isInTrending: true }));
    view.rerender(windowWith({ ...props, isOpen: true, isInTrending: true }));
    await settled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("clears a Copied left over from last time", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    const { props, view } = show();
    await settled();
    fireEvent.click(copyButton());
    await screen.findByRole("button", { name: en.buttons.copied });
    view.rerender(windowWith({ ...props, isOpen: false }));
    view.rerender(windowWith({ ...props, isOpen: true }));
    await settled();
    expect(copyButton()).toBeTruthy();
  });

  it("is reported each time it opens, and not while closed", async () => {
    const { props, view } = show({ isOpen: false });
    await settled();
    expect(analytics.trackShareModalOpened).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    view.rerender(windowWith({ ...props, isOpen: true }));
    await settled();
    expect(analytics.trackShareModalOpened).toHaveBeenCalledExactlyOnceWith({ tripId: "trip-1", tripDestination: "Lisbon: à la carte!" });
  });
});

describe("the window on a desktop", () => {
  it("is a named dialog showing the trip", async () => {
    show();
    await settled();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: en.share.titleWithInvite }).id).toBe(dialog.getAttribute("aria-labelledby"));
    expect(screen.getByText("Lisbon: à la carte!")).toBeTruthy();
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("closes from its button, from the dark around it, and from Escape", async () => {
    const { props } = show();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: en.share.a11y.close }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    const panel = screen.getByRole("heading", { name: en.share.titleWithInvite }).closest("[tabindex='-1']")!;
    fireEvent.click(panel.parentElement!);
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(document.querySelector("[aria-hidden='true'].fixed")!);
    expect(props.onClose).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(4);
  });

  it("stays open for a click inside it", async () => {
    const { props } = show();
    await settled();
    fireEvent.click(screen.getByRole("heading", { name: en.share.titleWithInvite }));
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("the window on a phone", () => {
  it("is a sheet with the same tabs and link", async () => {
    phone.is = true;
    const { props } = show();
    await settled();
    expect(screen.getByTestId("sheet")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: en.share.titleWithInvite })).toBeTruthy();
    expect(screen.getByLabelText(en.share.invite.publicLink)).toBeTruthy();
    fireEvent.click(inviteTab());
    expect(screen.getByText("co-planners")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "close the sheet" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves the keyboard to the sheet", async () => {
    phone.is = true;
    const { props } = show();
    await settled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("a closed window", () => {
  it("shows nothing", async () => {
    show({ isOpen: false });
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("sheet")).toBeNull();
  });
});
