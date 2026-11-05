/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, type ComponentProps, type ReactNode } from "react";
import { GUEST_LINK_KEY } from "@/lib/participants/link-trigger";
import type { TripDayState } from "@/lib/trip/live";
import SharedTripView from "./SharedTripView";

/**
 * What a shared trip page does around the plan: the visit it records, the referral
 * it keeps, the sharer who opens their own link and may claim the trip, the member
 * sent to the editor, the day a link points at, and the layout with participants
 * switched off. The read-only rules and the plan-own links are in read-only.vitest.tsx.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const SLUG = "lisbon-trip-abc123";

const state = vi.hoisted(() => ({
  viewer: null as { id: string; email?: string } | null,
  viewerLoading: false,
  params: new URLSearchParams(),
  participants: true,
  claim: null as { shareToken: string } | null,
  claimed: null as string | null,
  claimListeners: [] as Array<(id: string) => void>,
  pending: null as Record<string, unknown> | null,
  prefsSet: [] as Array<[string, string]>,
  cleared: 0,
  lazyProps: [] as Array<Record<string, unknown>>,
  today: [] as Array<Record<string, unknown>>,
  packing: [] as Array<Record<string, unknown>>,
  itinerary: [] as Array<Record<string, unknown>>,
  saveProps: {} as Record<string, unknown>,
}));
const pendingSave = vi.hoisted(() => ({
  getPending: async () => state.pending,
  clearPending: async () => {
    state.cleared += 1;
  },
}));
const spies = vi.hoisted(() => ({
  trackShareLinkClicked: vi.fn(),
  claimPendingTrip: vi.fn(async () => {}),
  cssVarHeight: vi.fn(),
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    state.lazyProps.push(props);
    return null;
  },
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, onClick, ...rest }: { href: string; children: ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/useCssVarHeight", () => ({ useCssVarHeight: spies.cssVarHeight }));
vi.mock("@/lib/analytics", () => ({ trackShareLinkClicked: spies.trackShareLinkClicked }));
vi.mock("@/lib/trips/anonymous-claim-client", () => ({
  readPendingClaim: async () => state.claim,
  claimPendingTrip: spies.claimPendingTrip,
}));
vi.mock("@/lib/trips/claimed-trip-signal", () => ({
  onClaimedTrip: (listener: (id: string) => void) => {
    state.claimListeners.push(listener);
    return () => {
      state.claimListeners = state.claimListeners.filter((l) => l !== listener);
    };
  },
  readClaimedTrip: () => state.claimed,
}));
vi.mock("@/lib/trip/useLiveTripState", () => ({ useLiveTripState: (initial: TripDayState) => initial }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => state.participants }));
vi.mock("@/lib/platform/storage", () => ({
  prefs: {
    set: async (key: string, value: string) => {
      state.prefsSet.push([key, value]);
    },
    get: async () => null,
    remove: async () => {},
  },
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: state.viewer, loading: state.viewerLoading }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock("@/lib/native/haptics", () => ({ hapticMedium: () => {}, hapticError: () => {} }));
vi.mock("@/hooks/useTravelDistances", () => ({
  useTravelDistances: () => ({ travelData: new Map(), isLoading: false }),
  segmentBetween: () => undefined,
}));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({
    convert: (value: number, currency: string) => ({ value, currency }),
    format: (value: number, currency: string) => `${value} ${currency}`,
    preferredCurrency: "EUR",
  }),
}));
vi.mock("@/components/DestinationHero", () => ({ default: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/trip/BackpackerHostelCta", () => ({ default: () => <div data-testid="hostel-cta" /> }));
vi.mock("@/components/trip/TodayPacking", () => ({
  default: (p: Record<string, unknown>) => {
    state.packing.push(p);
    return <div data-testid="today-packing" />;
  },
}));
vi.mock("@/components/trip/TripPackingEssentials", () => ({ default: () => <div data-testid="packing-essentials" /> }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/trip/WhoIsGoingCard", () => ({ default: () => <div data-testid="who-is-going" /> }));
vi.mock("@/components/trip/PlanByEmail", () => ({
  default: (p: { source: string; defaultEmail?: string }) => <div data-testid="plan-by-email" data-source={p.source} data-email={p.defaultEmail ?? ""} />,
}));
vi.mock("@/components/trip/ParticipantsBar", () => ({
  default: (p: { source: string; crewAsk: boolean; tripTitle: string; onSaveForLater: () => void }) => (
    <div data-testid="participants-bar" data-source={p.source} data-crew={String(p.crewAsk)} data-title={p.tripTitle}>
      <button onClick={p.onSaveForLater}>save for later from the bar</button>
    </div>
  ),
}));
vi.mock("@/components/trip/AnonymousActivityVoteBar", () => ({ AnonymousActivityVoteBar: () => <div data-testid="vote-bar" /> }));
vi.mock("@/components/trip/TodayView", () => ({
  default: (p: Record<string, unknown> & { onViewFullItinerary: () => void }) => {
    state.today.push(p);
    return <button data-testid="today-view" onClick={p.onViewFullItinerary}>see the whole plan</button>;
  },
}));
vi.mock("@/components/trip/ReadOnlyItinerary", () => ({
  default: (p: Record<string, unknown> & { selectedDay: number | null }) => {
    state.itinerary.push(p);
    return <div data-testid="itinerary" data-selected={String(p.selectedDay)} />;
  },
}));
vi.mock("@/components/ShareRow", () => ({
  default: (p: { url: string; title: string }) => <div data-testid="share-row" data-url={p.url} data-title={p.title} />,
}));
vi.mock("@/components/ui/SaveTripModal", () => ({
  default: (p: Record<string, unknown> & { isOpen: boolean; onClose: () => void }) => {
    state.saveProps = p;
    return <button data-testid="save-modal" data-open={String(p.isOpen)} onClick={p.onClose} />;
  },
  usePendingSaveTripAction: () => pendingSave,
}));

const upcoming = (over: Partial<TripDayState> = {}): TripDayState => ({
  phase: "upcoming",
  isLive: false,
  dayNumber: 1,
  totalDays: 2,
  todayLocalDate: "2026-10-05",
  daysUntilStart: 5,
  timeZone: "Europe/Lisbon",
  timeZoneSource: "stored",
  ...over,
});
const live = (dayNumber = 1) => upcoming({ phase: "live", isLive: true, dayNumber, daysUntilStart: 0 });

const trip = {
  id: "trip-1",
  title: "Lisbon Trip",
  status: "planning",
  startDate: "2026-10-10",
  endDate: "2026-10-11",
  budget: null,
  itinerary: [1, 2].map((n) => ({
    day_number: n,
    date: `2026-10-1${n - 1}`,
    theme: "Alfama",
    activities: [{ id: `a${n}`, name: "Tram 28", type: "attraction", start_time: "09:00", duration_minutes: 60, description: "", location: "Alfama" }],
  })) as never,
  meta: { destination: "Lisbon" },
};

type Props = ComponentProps<typeof SharedTripView>;
let fetched: Array<{ url: string; init?: RequestInit }>;
const viewPosts = () => fetched.filter((f) => f.url === "/api/trips/trip-1/view");
const funnel = () => fetched.filter((f) => f.url === "/api/funnel-event").map((f) => JSON.parse(String(f.init?.body)));
const settled = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const page = (over: Partial<Props> = {}) => (
  <SharedTripView trip={trip} dateRange="Oct 10 – 11" viewSource="shared" shareToken={TOKEN} liveState={upcoming()} {...over} />
);
const show = (over: Partial<Props> = {}) => render(page(over));
const publicPage = { slug: SLUG, url: `https://monkeytravel.app/trip/${SLUG}` };
const showPublic = (over: Partial<Props> = {}) => show({ shareToken: undefined, publicPage, viewSource: "public", ...over });

const realLocation = window.location;
const assign = vi.fn();

beforeEach(() => {
  state.viewer = null;
  state.viewerLoading = false;
  state.params = new URLSearchParams();
  state.participants = true;
  state.claim = null;
  state.claimed = null;
  state.claimListeners = [];
  state.pending = null;
  state.prefsSet = [];
  state.cleared = 0;
  state.lazyProps = [];
  state.today = [];
  state.packing = [];
  state.itinerary = [];
  state.saveProps = {};
  fetched = [];
  localStorage.clear();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetched.push({ url: String(url), init });
      return new Response(JSON.stringify({ tallies: {}, myVotes: {} }), { status: 200 });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("the visit", { timeout: 20_000 }, () => {
  it("is recorded once, with where it came from, and survives leaving the page", async () => {
    const view = show({ viewSource: "shared" });
    await settled();
    view.rerender(page({ viewSource: "shared" }));
    await settled();
    expect(viewPosts()).toHaveLength(1);
    expect(JSON.parse(String(viewPosts()[0].init?.body))).toEqual({ source: "shared" });
    expect(viewPosts()[0].init).toMatchObject({ method: "POST", keepalive: true });
  });

  it("is recorded once even when React runs the effect twice", async () => {
    render(<StrictMode>{page({ viewSource: "shared" })}</StrictMode>);
    await settled();
    expect(viewPosts()).toHaveLength(1);
  });

  it("is recorded again if it comes from elsewhere", async () => {
    const view = show({ viewSource: "shared" });
    await settled();
    view.rerender(page({ viewSource: "public" }));
    await settled();
    expect(viewPosts().map((f) => JSON.parse(String(f.init?.body)).source)).toEqual(["shared", "public"]);
  });

  it("isn't recorded where no source is given", async () => {
    show({ viewSource: undefined });
    await settled();
    expect(viewPosts()).toHaveLength(0);
  });

  it("never gets in the visitor's way", async () => {
    vi.mocked(fetch).mockImplementation(() => {
      throw new Error("offline");
    });
    show();
    await settled();
    expect(screen.getByTestId("itinerary")).toBeTruthy();
  });

  it("counts as a share link followed, with where they came from", async () => {
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://wa.me/" });
    show();
    await settled();
    expect(spies.trackShareLinkClicked).toHaveBeenCalledExactlyOnceWith({ tripId: "trip-1", referrer: "https://wa.me/" });
  });
});

describe("the owner's referral code", { timeout: 20_000 }, () => {
  it("is kept for a signup through the normal nav", async () => {
    state.params = new URLSearchParams("ref=OWNER1");
    show();
    await settled();
    expect(localStorage.getItem("referral_code")).toBe("OWNER1");
  });

  it("doesn't overwrite one kept before with nothing", async () => {
    localStorage.setItem("referral_code", "EARLIER");
    state.params = new URLSearchParams("ref=%20%20");
    show();
    await settled();
    expect(localStorage.getItem("referral_code")).toBe("EARLIER");
  });

  it("goes on the plan-own link", async () => {
    state.params = new URLSearchParams("ref=OWNER1");
    show();
    await settled();
    const link = within(screen.getByTestId("recipient-footer-cta")).getByText("share.savedHero.planOwnButton").closest("a");
    expect(link?.getAttribute("href")).toBe("/trips/new?destination=Lisbon&ref=OWNER1");
    fireEvent.click(link!);
    expect(funnel()).toEqual([
      { event_type: "plan_own_clicked", trip_id: "trip-1", destination: "Lisbon", referral_code: "OWNER1", surface: "shared_footer" },
    ]);
  });

  it("survives storage being unavailable", async () => {
    state.params = new URLSearchParams("ref=OWNER1");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    show();
    await settled();
    expect(screen.getByTestId("itinerary")).toBeTruthy();
  });
});

describe("a signed-out reader of a share link", { timeout: 20_000 }, () => {
  it("is noted as a guest, so a later sign-in can hand their joining over", async () => {
    show();
    await settled();
    expect(state.prefsSet).toEqual([[GUEST_LINK_KEY, "1"]]);
  });

  it("isn't on the public page, where nobody joins or pays", async () => {
    showPublic();
    await settled();
    expect(state.prefsSet).toEqual([]);
  });

  it("isn't, while sign-in is still being read, or once signed in", async () => {
    state.viewerLoading = true;
    show();
    await settled();
    expect(state.prefsSet).toEqual([]);
    cleanup();
    state.viewerLoading = false;
    state.viewer = { id: "viewer-1" };
    show();
    await settled();
    expect(state.prefsSet).toEqual([]);
  });
});

describe("a save started before signing in", { timeout: 20_000 }, () => {
  const started = { shareToken: TOKEN, startDate: "2026-11-01", timestamp: 1 };

  it("reopens the dialog with its date, and is forgotten", async () => {
    state.viewer = { id: "viewer-1" };
    state.pending = started;
    show();
    await waitFor(() => expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true"));
    expect(state.saveProps.initialStartDate).toBe("2026-11-01");
    expect(state.cleared).toBe(1);
  });

  it("waits for a signed-in viewer", async () => {
    state.pending = started;
    show();
    await settled();
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("false");
    expect(state.cleared).toBe(0);
    cleanup();
    state.viewer = { id: "viewer-1" };
    state.viewerLoading = true;
    show();
    await settled();
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("false");
  });

  it("is left alone when it was for another link", async () => {
    state.viewer = { id: "viewer-1" };
    state.pending = { shareToken: "another-token", timestamp: 1 };
    show();
    await settled();
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("false");
    expect(state.cleared).toBe(0);
  });

  it("is matched by its slug on the public page", async () => {
    state.viewer = { id: "viewer-1" };
    state.pending = { publicSlug: SLUG, startDate: "2026-11-01", timestamp: 1 };
    showPublic();
    await waitFor(() => expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true"));
    cleanup();
    state.pending = { publicSlug: "another-slug", timestamp: 1 };
    state.cleared = 0;
    showPublic();
    await settled();
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("false");
    expect(state.cleared).toBe(0);
  });

  it("closes like any dialog", async () => {
    state.viewer = { id: "viewer-1" };
    state.pending = started;
    show();
    await waitFor(() => expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true"));
    fireEvent.click(screen.getByTestId("save-modal"));
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("false");
  });

  it("gives the dialog the trip's name, place and length", async () => {
    show();
    await settled();
    expect(state.saveProps).toMatchObject({ shareToken: TOKEN, tripTitle: "Lisbon Trip", tripDestination: "Lisbon", durationDays: 2 });
  });
});

describe("the sharer opening their own link", { timeout: 20_000 }, () => {
  beforeEach(() => {
    state.claim = { shareToken: TOKEN };
  });
  const strip = () => document.querySelector("[data-owner-claim-strip]");

  it("is offered the sign-up that keeps the trip, back to this link, in place of the other asks", async () => {
    show();
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(within(strip() as HTMLElement).getByText("share.ownerClaim.cta").closest("a")?.getAttribute("href")).toBe(
      `/auth/signup?redirect=${encodeURIComponent(`/shared/${TOKEN}`)}`
    );
    expect(screen.queryByTestId("recipient-footer-cta")).toBeNull();
  });

  it("publishes the strip's height, so the cookie banner sits above it", async () => {
    show();
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(spies.cssVarHeight).toHaveBeenCalledWith(expect.anything(), "--mt-bottom-bar-h");
    expect(screen.getByTestId("trip-bottom-bar").contains(strip())).toBe(true);
  });

  it("isn't, for a claim on another link", async () => {
    state.claim = { shareToken: "another-token" };
    show();
    await settled();
    expect(strip()).toBeNull();
    expect(screen.getByTestId("recipient-footer-cta")).toBeTruthy();
  });

  it("isn't, on the public page, which has no link to claim", async () => {
    showPublic();
    await settled();
    expect(strip()).toBeNull();
  });

  it("isn't, for a claim without a link, on the public page", async () => {
    state.claim = {} as never;
    showPublic();
    await settled();
    expect(strip()).toBeNull();
  });

  it("isn't, and nothing moves or claims, with no claim here", async () => {
    state.claim = null;
    state.claimed = "trip-1";
    state.viewer = { id: "viewer-1" };
    show();
    await settled();
    expect(strip()).toBeNull();
    expect(state.claimListeners).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
    expect(spies.claimPendingTrip).not.toHaveBeenCalled();
  });

  it("claims it from here once signed in", async () => {
    state.viewer = { id: "viewer-1" };
    show();
    await waitFor(() => expect(spies.claimPendingTrip).toHaveBeenCalledTimes(1));
  });

  it("doesn't claim signed out, or while sign-in is being read", async () => {
    show();
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(spies.claimPendingTrip).not.toHaveBeenCalled();
    cleanup();
    state.viewer = { id: "viewer-1" };
    state.viewerLoading = true;
    show();
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(spies.claimPendingTrip).not.toHaveBeenCalled();
  });

  it("moves onto the trip when the claim lands, by a full load", async () => {
    show();
    await waitFor(() => expect(state.claimListeners).toHaveLength(1));
    act(() => state.claimListeners[0]("trip-1"));
    expect(assign).toHaveBeenCalledExactlyOnceWith("/trips/trip-1");
  });

  it("moves at once when the claim had already landed", async () => {
    state.claimed = "trip-1";
    show();
    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith("/trips/trip-1"));
  });

  it("stays when another trip's claim lands", async () => {
    state.claimed = "trip-9";
    show();
    await waitFor(() => expect(state.claimListeners).toHaveLength(1));
    act(() => state.claimListeners[0]("trip-9"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops listening when the page goes", async () => {
    const view = show();
    await waitFor(() => expect(state.claimListeners).toHaveLength(1));
    view.unmount();
    expect(state.claimListeners).toHaveLength(0);
  });

  it("ignores a claim read after the page has gone", async () => {
    const view = show();
    view.unmount();
    await settled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("a member of the trip", { timeout: 20_000 }, () => {
  it("is sent to the editor, and without it sees no such bar", async () => {
    show({ editorHref: "/trips/trip-1" });
    await settled();
    expect(within(screen.getByTestId("member-edit-bar")).getByTestId("member-edit-link").getAttribute("href")).toBe("/trips/trip-1");
    cleanup();
    show();
    await settled();
    expect(screen.queryByTestId("member-edit-bar")).toBeNull();
  });
});

describe("the top of the page", { timeout: 20_000 }, () => {
  it("names a crew ask to the participants bar, and passes on the trip", async () => {
    state.params = new URLSearchParams("vote=1");
    show();
    await settled();
    expect(screen.getByTestId("participants-bar").getAttribute("data-source")).toBe("crew_ask");
    expect(screen.getByTestId("participants-bar").getAttribute("data-crew")).toBe("true");
    expect(screen.getByTestId("participants-bar").getAttribute("data-title")).toBe("Lisbon Trip");
    expect(screen.getByTestId("plan-by-email").getAttribute("data-source")).toBe("crew_ask");
  });

  it("calls an ordinary link just shared", async () => {
    show();
    await settled();
    expect(screen.getByTestId("participants-bar").getAttribute("data-source")).toBe("shared");
    expect(screen.getByTestId("participants-bar").getAttribute("data-crew")).toBe("false");
    expect(screen.getByTestId("plan-by-email").getAttribute("data-source")).toBe("shared");
  });

  it("opens the save dialog from the bar", async () => {
    show();
    await settled();
    fireEvent.click(screen.getByText("save for later from the bar"));
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true");
  });

  it("offers the signed-in reader the plan by email at their own address", async () => {
    state.viewer = { id: "viewer-1", email: "bea@example.com" };
    show();
    await settled();
    expect(screen.getByTestId("plan-by-email").getAttribute("data-email")).toBe("bea@example.com");
  });
});

describe("the end of the page for the owner", { timeout: 20_000 }, () => {
  it("with participants off, gets the same layout as anyone", async () => {
    state.participants = false;
    show({ isOwner: true });
    await settled();
    expect(screen.queryByTestId("who-is-going")).toBeNull();
    expect(screen.getByText("shared.voteInviteTitle")).toBeTruthy();
    expect(screen.getByTestId("trip-bottom-bar")).toBeTruthy();
  });

  it("asks nothing of them", async () => {
    show({ isOwner: true });
    await settled();
    expect(screen.queryByTestId("recipient-footer-cta")).toBeNull();
    expect(screen.queryByTestId("trip-bottom-bar")).toBeNull();
    expect(screen.getByTestId("who-is-going")).toBeTruthy();
  });

  it("still offers saving from the footer's second button to a reader", async () => {
    show();
    await settled();
    fireEvent.click(within(screen.getByTestId("recipient-footer-cta")).getByText("share.participants.saveForLater"));
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true");
  });
});

describe("with participants switched off", { timeout: 20_000 }, () => {
  beforeEach(() => {
    state.participants = false;
  });

  it("invites a vote, in the crew's words when it's a crew ask", async () => {
    show();
    await settled();
    expect(screen.getByText("shared.voteInviteTitle")).toBeTruthy();
    expect(screen.getByText("shared.voteInviteBody")).toBeTruthy();
    expect(screen.queryByTestId("participants-bar")).toBeNull();
    cleanup();
    state.params = new URLSearchParams("vote=1");
    show();
    await settled();
    expect(screen.getByText("share.crewPrompt.title")).toBeTruthy();
    expect(screen.getByText("share.crewPrompt.body")).toBeTruthy();
  });

  it("shows the map from the start, and the engagement slot", async () => {
    show({ engagementSlot: <div data-testid="engagement" /> });
    await settled();
    expect(screen.getByTestId("engagement")).toBeTruthy();
    expect(screen.getByText("share.savedHero.loveTitle")).toBeTruthy();
  });

  it("ends on the two-button bar: saving, and planning their own", async () => {
    show();
    await settled();
    const bar = screen.getByTestId("trip-bottom-bar");
    expect(screen.queryByTestId("recipient-footer-cta")).toBeNull();
    fireEvent.click(within(bar).getByText("share.savedHero.saveButton"));
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true");
    const own = within(bar).getByText("share.savedHero.planOwnButton");
    expect(own.closest("a")?.getAttribute("href")).toBe("/trips/new?destination=Lisbon");
    fireEvent.click(own);
    expect(funnel()).toEqual([expect.objectContaining({ surface: "bottom_bar" })]);
  });

  it("the sharer's strip still wins", async () => {
    state.claim = { shareToken: TOKEN };
    show();
    await waitFor(() => expect(document.querySelector("[data-owner-claim-strip]")).not.toBeNull());
    expect(screen.queryByText("share.savedHero.saveButton")).toBeNull();
  });
});

describe("the end of the page", { timeout: 20_000 }, () => {
  it("offers planning their own trip once more, and says where it was pressed", async () => {
    state.params = new URLSearchParams("ref=OWNER1");
    show();
    await settled();
    const link = screen.getByText("share.savedHero.planOwnButtonGeneric").closest("a");
    expect(link?.getAttribute("href")).toBe("/trips/new?destination=Lisbon&ref=OWNER1");
    fireEvent.click(link!);
    expect(funnel()).toEqual([expect.objectContaining({ surface: "page_footer", referral_code: "OWNER1" })]);
  });
});

describe("the top of the public page", { timeout: 20_000 }, () => {
  it("shares its own address, under the trip's name", async () => {
    showPublic();
    await settled();
    expect(screen.getByTestId("share-row").getAttribute("data-url")).toBe(publicPage.url);
    expect(screen.getByTestId("share-row").getAttribute("data-title")).toBe("Lisbon Trip");
  });

  it("asks nothing with participants off", async () => {
    state.participants = false;
    showPublic();
    await settled();
    expect(screen.queryByTestId("public-trip-actions")).toBeNull();
  });

  it("asks nothing without a public page to share", async () => {
    show({ shareToken: undefined });
    await settled();
    expect(screen.queryByTestId("public-trip-actions")).toBeNull();
  });
});

describe("with participants on", { timeout: 20_000 }, () => {
  it("keeps the map a tap away, and leaves out the engagement slot and the save hero", async () => {
    show({ engagementSlot: <div data-testid="engagement" /> });
    await settled();
    expect(screen.queryByTestId("engagement")).toBeNull();
    expect(screen.queryByText("share.savedHero.loveTitle")).toBeNull();
  });
});

describe("the day a link points at", { timeout: 20_000 }, () => {
  it("opens on that day, not on Today", async () => {
    state.params = new URLSearchParams("day=2");
    show({ liveState: live(1) });
    await settled();
    expect(screen.queryByTestId("today-view")).toBeNull();
    expect(screen.getByTestId("itinerary").getAttribute("data-selected")).toBe("2");
    expect(screen.getByTestId("back-to-today")).toBeTruthy();
  });

  it.each([
    ["it's today, which Today already shows", "day=1", 1],
    ["the trip has no such day", "day=9", 1],
    ["it isn't a day at all", "day=soon", 1],
  ])("is ignored when %s", async (_name, query, dayNumber) => {
    state.params = new URLSearchParams(query);
    show({ liveState: live(dayNumber) });
    await settled();
    expect(screen.getByTestId("today-view")).toBeTruthy();
  });

  it("selects it on a trip that hasn't started", async () => {
    state.params = new URLSearchParams("day=2");
    show();
    await settled();
    expect(screen.getByTestId("itinerary").getAttribute("data-selected")).toBe("2");
  });

  it("selects nothing without one", async () => {
    show();
    await settled();
    expect(screen.getByTestId("itinerary").getAttribute("data-selected")).toBe("null");
  });
});

describe("Today, during the trip", { timeout: 20_000 }, () => {
  it("opens first, and the whole plan is a tap away and back", async () => {
    show({ liveState: live() });
    await settled();
    expect(screen.queryByTestId("itinerary")).toBeNull();
    fireEvent.click(screen.getByTestId("today-view"));
    expect(screen.getByTestId("itinerary")).toBeTruthy();
    fireEvent.click(screen.getByTestId("back-to-today"));
    expect(screen.getByTestId("today-view")).toBeTruthy();
  });

  it("offers no way back before the trip", async () => {
    show();
    await settled();
    expect(screen.queryByTestId("back-to-today")).toBeNull();
  });
});

describe("the packing checklist on its own", { timeout: 20_000 }, () => {
  const packed = { ...trip, packingList: [{ id: "p1", label: "Passport" }] } as never;

  it.each([
    ["the day before", 1],
    ["on the day it hasn't begun", 0],
  ])("shows %s, open", async (_name, daysUntilStart) => {
    show({ trip: packed, liveState: upcoming({ daysUntilStart }) });
    await settled();
    expect(screen.getByTestId("today-packing")).toBeTruthy();
    expect(state.packing.at(-1)).toMatchObject({ tripId: "trip-1", defaultOpen: true });
  });

  it("waits until the day before", async () => {
    show({ trip: packed, liveState: upcoming({ daysUntilStart: 2 }) });
    await settled();
    expect(screen.queryByTestId("today-packing")).toBeNull();
  });

  it("isn't shown with nothing to pack, or once the trip is on", async () => {
    show({ liveState: upcoming({ daysUntilStart: 1 }) });
    await settled();
    expect(screen.queryByTestId("today-packing")).toBeNull();
    cleanup();
    show({ trip: packed, liveState: live() });
    await settled();
    expect(screen.queryByTestId("today-packing")).toBeNull();
  });
});

describe("a backpacker's trip", { timeout: 20_000 }, () => {
  it("offers hostels and says so at the top", async () => {
    show({ trip: { ...trip, meta: { destination: "Lisbon", travel_style: "backpacker" } } as never });
    await settled();
    expect(screen.getByTestId("hostel-cta")).toBeTruthy();
    expect(screen.getByText("shared.backpackerRoute")).toBeTruthy();
  });

  it("doesn't on any other", async () => {
    show();
    await settled();
    expect(screen.queryByTestId("hostel-cta")).toBeNull();
    expect(screen.queryByText("shared.backpackerRoute")).toBeNull();
  });
});
