/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TripDayState } from "@/lib/trip/live";
import SharedTripView from "./SharedTripView";

/**
 * The public trip page renders this view without the share token. Joining,
 * votes, Today's actions and expenses all go through the share link, which
 * belongs to the group it was sent to, so none of them may appear or call
 * out there. Sharing and saving use the public URL and slug instead.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const SLUG = "lisbon-trip-abc123";
const PUBLIC_URL = `https://monkeytravel.app/trip/${SLUG}`;

const state = vi.hoisted(() => ({
  viewer: null as { id: string } | null,
  pending: null as Record<string, unknown> | null,
  prefsSet: [] as Array<[string, string]>,
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useCssVarHeight", () => ({ useCssVarHeight: () => {} }));
vi.mock("@/lib/analytics", () => ({ trackShareLinkClicked: () => {} }));
vi.mock("@/lib/i18n/activity-type", () => ({ useActivityTypeLabel: () => (type: string) => type }));
vi.mock("@/lib/trips/anonymous-claim-client", () => ({ readPendingClaim: async () => null, claimPendingTrip: async () => {} }));
vi.mock("@/lib/trips/claimed-trip-signal", () => ({ onClaimedTrip: () => () => {}, readClaimedTrip: () => null }));
vi.mock("@/lib/trip/useLiveTripState", () => ({ useLiveTripState: (initial: TripDayState) => initial }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/platform/storage", () => ({
  prefs: {
    set: async (key: string, value: string) => {
      state.prefsSet.push([key, value]);
    },
    get: async () => null,
    remove: async () => {},
  },
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: state.viewer, loading: false }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock("@/lib/native/haptics", () => ({ hapticMedium: () => {}, hapticError: () => {} }));
vi.mock("@/lib/hooks/useTravelDistances", () => ({ useTravelDistances: () => ({ travelData: new Map(), isLoading: false }) }));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({
    convert: (value: number, currency: string) => ({ value, currency, formatted: `${value} ${currency}` }),
    format: (value: number, currency: string) => `${value} ${currency}`,
    preferredCurrency: "EUR",
  }),
}));
vi.mock("@/components/DestinationHero", () => ({ default: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ErrorBoundary", () => ({ default: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock("@/components/ActivityCard", () => ({ default: () => <div data-testid="activity-card" /> }));
vi.mock("@/components/trip/BackpackerHostelCta", () => ({ default: () => null }));
vi.mock("@/components/trip/TodayPacking", () => ({ default: () => null }));
vi.mock("@/components/trip/TripPackingEssentials", () => ({ default: () => null }));
vi.mock("@/components/ui/DaySlider", () => ({ default: () => null }));
vi.mock("@/components/trip/TravelConnector", () => ({ default: () => null }));
vi.mock("@/components/trip/DaySummary", () => ({ default: () => null }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/trip/WhoIsGoingCard", () => ({ default: () => <div data-testid="who-is-going" /> }));
vi.mock("@/components/trip/ParticipantsBar", () => ({
  default: ({ shareToken }: { shareToken: string }) => <div data-testid="participants-bar" data-token={shareToken} />,
}));
vi.mock("@/components/trip/AnonymousActivityVoteBar", () => ({ AnonymousActivityVoteBar: () => <div data-testid="vote-bar" /> }));
vi.mock("@/components/trip/TodayView", () => ({
  default: ({ apiBase }: { apiBase?: string }) => <div data-testid="today-view" data-api-base={apiBase ?? "none"} />,
}));
vi.mock("@/components/ShareRow", () => ({ default: ({ url }: { url: string }) => <div data-testid="share-row" data-url={url} /> }));
vi.mock("@/components/ui/SaveTripModal", () => ({
  default: ({ isOpen, shareToken, publicSlug }: { isOpen: boolean; shareToken?: string; publicSlug?: string }) => (
    <div data-testid="save-modal" data-open={String(isOpen)} data-token={shareToken ?? "none"} data-slug={publicSlug ?? "none"} />
  ),
  usePendingSaveTripAction: () => ({ getPending: async () => state.pending, clearPending: async () => {} }),
}));

const day = (isLive: boolean): TripDayState => ({
  phase: isLive ? "live" : "upcoming",
  isLive,
  dayNumber: 1,
  totalDays: 2,
  todayLocalDate: "2026-10-10",
  daysUntilStart: isLive ? 0 : 5,
  timeZone: "Europe/Lisbon",
  timeZoneSource: "stored",
});

const trip = {
  id: "trip-1",
  title: "Lisbon Trip",
  status: "planning",
  startDate: "2026-10-10",
  endDate: "2026-10-11",
  budget: null,
  itinerary: [
    {
      day_number: 1,
      date: "2026-10-10",
      theme: "Alfama",
      activities: [{ id: "a1", name: "Tram 28", type: "attraction", start_time: "09:00", duration_minutes: 60, description: "", location: "Alfama" }],
    },
  ] as never,
  meta: { destination: "Lisbon" },
};

let fetched: string[];

function renderView({ token, live = false, isOwner = false }: { token?: string; live?: boolean; isOwner?: boolean }) {
  return render(
    <SharedTripView
      trip={trip}
      dateRange="Oct 10 – 11"
      viewSource={token ? "shared" : "public"}
      isOwner={isOwner}
      liveState={day(live)}
      {...(token ? { shareToken: token } : { publicPage: { slug: SLUG, url: PUBLIC_URL } })}
    />,
  );
}

beforeEach(() => {
  state.viewer = null;
  state.pending = null;
  state.prefsSet = [];
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(String(url));
      return new Response(JSON.stringify({ tallies: {}, myVotes: {} }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Each test renders the whole view: give it room when the suite runs at once.
describe("the public page's view is read-only", { timeout: 20_000 }, () => {
  it("offers no way to join, vote or act for the group", async () => {
    renderView({});
    expect(screen.queryByTestId("participants-bar")).toBeNull();
    expect(screen.queryByTestId("vote-bar")).toBeNull();
    expect(screen.getByTestId("activity-card")).toBeTruthy();
    await waitFor(() => expect(fetched).toContain("/api/trips/trip-1/view"));
    expect(fetched.filter((url) => url.includes("/api/shared/"))).toEqual([]);
  });

  it("shows a live trip's Today without the group's routes", () => {
    renderView({ live: true });
    expect(screen.getByTestId("today-view").getAttribute("data-api-base")).toBe("none");
  });

  it("shares the public URL and saves by the slug", () => {
    renderView({});
    expect(screen.getByTestId("share-row").getAttribute("data-url")).toBe(PUBLIC_URL);
    const modal = screen.getByTestId("save-modal");
    expect(modal.getAttribute("data-token")).toBe("none");
    expect(modal.getAttribute("data-slug")).toBe(SLUG);
    fireEvent.click(within(screen.getByTestId("public-trip-actions")).getByText("share.participants.saveForLater"));
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true");
  });

  it("does not mark a signed-out visitor as a guest who may have joined or paid", async () => {
    renderView({});
    await waitFor(() => expect(fetched).toContain("/api/trips/trip-1/view"));
    expect(state.prefsSet).toEqual([]);
  });

  it("resumes a save started on this page, and only that one", async () => {
    state.viewer = { id: "viewer-1" };
    state.pending = { tripTitle: "Somewhere else", templateId: "template-1", timestamp: Date.now() };
    renderView({});
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("false");
    cleanup();

    state.pending = { tripTitle: "Lisbon Trip", publicSlug: SLUG, startDate: "2026-11-01", timestamp: Date.now() };
    renderView({});
    await waitFor(() => expect(screen.getByTestId("save-modal").getAttribute("data-open")).toBe("true"));
  });

  it("still shows the owner who is going", () => {
    renderView({ isOwner: true });
    expect(screen.getByTestId("who-is-going")).toBeTruthy();
    expect(screen.queryByTestId("participants-bar")).toBeNull();
  });
});

describe("the share link keeps the group's controls", { timeout: 20_000 }, () => {
  it("joins, votes and saves through the token", async () => {
    renderView({ token: TOKEN });
    expect(screen.getByTestId("participants-bar").getAttribute("data-token")).toBe(TOKEN);
    expect(screen.getByTestId("vote-bar")).toBeTruthy();
    expect(screen.queryByTestId("share-row")).toBeNull();
    expect(screen.getByTestId("save-modal").getAttribute("data-token")).toBe(TOKEN);
    await waitFor(() => expect(fetched).toContain(`/api/shared/${TOKEN}/votes`));
  });

  it("acts on Today through the share link's routes", () => {
    renderView({ token: TOKEN, live: true });
    expect(screen.getByTestId("today-view").getAttribute("data-api-base")).toBe(`/api/shared/${TOKEN}`);
  });
});
