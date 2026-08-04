/**
 * Tests for SharePromptOnTrip — the gate that decides whether the share ask
 * fires at all (spec C1).
 *
 * This component is almost entirely gate: it renders null until four
 * independent conditions agree. The failure mode that matters is NOT a
 * rendering bug, it is the prompt never firing — or firing at someone it
 * should not. That is invisible in production until three weeks of flat
 * share numbers, so it is worth pinning down here.
 *
 * The four conditions, each tested for both outcomes:
 *   1. viewer owns the trip
 *   2. the trip has no share link yet
 *   3. the user has engaged (scroll past 600px, or 25s dwell)
 *   4. they have not dismissed this trip before (persisted per trip)
 *
 * The modal itself is stubbed. What it looks like is ShareAfterSaveModal's
 * problem; whether it is reached is this component's.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import SharePromptOnTrip from "./SharePromptOnTrip";

// next/dynamic would resolve the real modal (and its i18n + BaseModal tree).
// Stub it to a marker so the assertions are about the gate, not the modal.
vi.mock("next/dynamic", () => ({
  default: () =>
    function StubModal(props: { isOpen: boolean; onClose: () => void }) {
      return props.isOpen ? (
        <div data-testid="share-modal">
          <button data-testid="dismiss" onClick={props.onClose}>
            close
          </button>
        </div>
      ) : null;
    },
}));

const captureVariantShown = vi.fn();
vi.mock("@/lib/posthog/events", () => ({
  captureSharePromptVariantShown: (...a: unknown[]) => captureVariantShown(...a),
  captureExploreTripPublished: vi.fn(),
  captureExploreTripPublishFailed: vi.fn(),
}));

const BASE = {
  tripId: "trip-1",
  tripTitle: "Lisbon Trip",
  tripDays: 4,
  destination: "Lisbon",
  isOwner: true,
  onManageCollaborators: vi.fn(),
};

/** Share-status endpoint: `shared` decides whether a link already exists. */
function mockShareStatus(opts: { shared?: boolean; ok?: boolean } = {}) {
  const { shared = false, ok = true } = opts;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => (shared ? { shareToken: "tok_abc" } : {}),
    })
  );
}

/** Engagement trigger 1: scroll past the 600px threshold. */
function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true });
  window.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  captureVariantShown.mockClear();
  mockShareStatus();
  // jsdom shares one window across a file, so scrollY survives between tests.
  // The component calls onScroll() on mount (to catch a restored scroll
  // position), so a previous test's scroll would fire the prompt immediately.
  scrollTo(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SharePromptOnTrip — eligibility", () => {
  it("does not fire for a non-owner, even after engagement", async () => {
    render(<SharePromptOnTrip {...BASE} isOwner={false} />);
    act(() => scrollTo(2000));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByTestId("share-modal")).toBeNull();
    // A non-owner must not even be asked about the trip's share state.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fire when the trip already has a share link", async () => {
    mockShareStatus({ shared: true });
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(2000));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    // Asking someone to do the thing they already did is the whole point of
    // the check.
    expect(screen.queryByTestId("share-modal")).toBeNull();
  });

  it("stays quiet when the share-status call fails", async () => {
    mockShareStatus({ ok: false });
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(2000));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    // Can't tell -> don't nag. Wrongly asking is worse than not asking.
    expect(screen.queryByTestId("share-modal")).toBeNull();
  });
});

describe("SharePromptOnTrip — engagement gate", () => {
  it("does NOT fire on load — the whole point of moving it off save", async () => {
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("share-modal")).toBeNull();
  });

  it("fires once the user scrolls past the threshold", async () => {
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(700));
    expect(await screen.findByTestId("share-modal")).toBeTruthy();
  });

  it("does not fire on a shallow scroll", async () => {
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(200));
    expect(screen.queryByTestId("share-modal")).toBeNull();
  });

  it("fires on dwell alone, for a user who never scrolls", async () => {
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {
      vi.advanceTimersByTime(25_000);
    });
    expect(await screen.findByTestId("share-modal")).toBeTruthy();
  });

  it("has not fired one tick before the dwell elapses", async () => {
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {
      vi.advanceTimersByTime(24_000);
    });
    expect(screen.queryByTestId("share-modal")).toBeNull();
  });
});

describe("SharePromptOnTrip — dismissal", () => {
  it("persists dismissal per trip and stays gone on remount", async () => {
    const { unmount } = render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(700));
    (await screen.findByTestId("dismiss")).click();
    await waitFor(() => expect(screen.queryByTestId("share-modal")).toBeNull());
    expect(localStorage.getItem("share_prompt_dismissed:trip-1")).toBe("1");

    // Tomorrow, same trip: must not be asked again.
    unmount();
    render(<SharePromptOnTrip {...BASE} />);
    act(() => scrollTo(2000));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByTestId("share-modal")).toBeNull();
  });

  it("scopes dismissal to the trip, not the user", async () => {
    localStorage.setItem("share_prompt_dismissed:trip-1", "1");
    render(<SharePromptOnTrip {...BASE} tripId="trip-2" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(700));
    // Saying no to one trip is not saying no forever.
    expect(await screen.findByTestId("share-modal")).toBeTruthy();
  });
});

describe("SharePromptOnTrip — instrumentation", () => {
  it("reports the variant exactly once, with the intent branch", async () => {
    render(<SharePromptOnTrip {...BASE} tripIntent="group" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(700));
    await screen.findByTestId("share-modal");

    // Re-render churn must not inflate the denominator of the A/B.
    act(() => scrollTo(900));
    act(() => scrollTo(1200));

    expect(captureVariantShown).toHaveBeenCalledTimes(1);
    expect(captureVariantShown).toHaveBeenCalledWith({
      trip_id: "trip-1",
      intent: "group",
      surface: "trip_detail",
    });
  });

  it("reports unspecified when the user never answered the step-1 question", async () => {
    render(<SharePromptOnTrip {...BASE} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => scrollTo(700));
    await screen.findByTestId("share-modal");
    expect(captureVariantShown).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "unspecified" })
    );
  });
});
