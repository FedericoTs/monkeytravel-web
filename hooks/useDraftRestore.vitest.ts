import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import type { ItineraryDraft } from "@/hooks/useItineraryDraft";
import type { GeneratedItinerary } from "@/types";

const stored = new Map<string, string>();
// Held open so the saved-trip check answers before the stored flag is read.
let prefsAnswer: Promise<void> = Promise.resolve();
const savedTripOf = vi.fn();
const trackWizardEvent = vi.fn();
vi.mock("@/lib/platform/storage", () => ({
  prefs: {
    get: async (k: string) => {
      if (k === "pendingTripGeneration") await prefsAnswer;
      return stored.get(k) ?? null;
    },
    remove: async (k: string) => void stored.delete(k),
  },
}));
vi.mock("@/lib/wizard/draft-saved-check", () => ({ savedTripOf: (...a: unknown[]) => savedTripOf(...a) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/wizard/wizardEvents", () => ({ trackWizardEvent: (...a: unknown[]) => trackWizardEvent(...a) }));

import { useDraftRestore } from "./useDraftRestore";

const itinerary = { days: [{ day_number: 1 }, { day_number: 2 }] } as unknown as GeneratedItinerary;
const fullDraft: ItineraryDraft = {
  generatedItinerary: itinerary,
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-11",
  pace: "relaxed",
  vibes: ["foodie"],
  budgetTier: "balanced",
  savedAt: 1,
};
const targets = () => ({
  setDestination: vi.fn(),
  setStartDate: vi.fn(),
  setEndDate: vi.fn(),
  setPace: vi.fn(),
  setSelectedVibes: vi.fn(),
  setBudgetTier: vi.fn(),
  setMustDos: vi.fn(),
  setDietary: vi.fn(),
  setTravelStyle: vi.fn(),
  setAnchors: vi.fn(),
  setTripIntent: vi.fn(),
  setFlexibleDates: vi.fn(),
  setGeneratedItinerary: vi.fn(),
  registerRestore: vi.fn(),
});

type Props = Parameters<typeof useDraftRestore>[0];
let draftTargets = targets();
const clearDraft = vi.fn();
const handleGenerate = vi.fn();
const props = (over: Partial<Props> = {}): Props => ({
  draft: fullDraft,
  hasDraft: true,
  isExpired: false,
  clearDraft,
  draftTargets,
  isAuthenticated: false,
  authUser: null,
  generatedItinerary: null,
  generating: false,
  savedTripId: null,
  destination: "",
  startDate: "",
  endDate: "",
  selectedVibes: [],
  locale: "en",
  handleGenerate,
  ...over,
});
const user = { id: "u1" } as User;

beforeEach(() => {
  stored.clear();
  prefsAnswer = Promise.resolve();
  draftTargets = targets();
  sessionStorage.clear();
  [savedTripOf, trackWizardEvent, clearDraft, handleGenerate].forEach((fn) => fn.mockReset());
  savedTripOf.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("useDraftRestore", () => {
  it("waits for the auth state, then offers a signed-out planner the banner", async () => {
    const { result, rerender } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props({ isAuthenticated: null }) });
    await act(() => Promise.resolve());
    expect(result.current.showDraftRecovery).toBe(false);
    rerender(props({ isAuthenticated: false }));
    await waitFor(() => expect(result.current.showDraftRecovery).toBe(true));
    expect(draftTargets.setGeneratedItinerary).not.toHaveBeenCalled();
  });

  it("puts the draft back from the banner, or discards it", async () => {
    const { result } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props() });
    await waitFor(() => expect(result.current.showDraftRecovery).toBe(true));
    act(() => result.current.handleRestoreDraft());
    expect(draftTargets.setGeneratedItinerary).toHaveBeenCalledWith(itinerary);
    expect(trackWizardEvent).toHaveBeenCalledWith("draft_restored", { destination: "Lisbon, Portugal", duration_days: 2, locale: "en" });
    expect(result.current.showDraftRecovery).toBe(false);
    act(() => result.current.handleDiscardDraft());
    expect(clearDraft).toHaveBeenCalledTimes(1);
  });

  it("puts an unsaved draft back for a signed-in planner without asking", async () => {
    const { result } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props({ isAuthenticated: true, authUser: user }) });
    await waitFor(() => expect(result.current.draftAutoRestored).toBe(true));
    expect(draftTargets.setGeneratedItinerary).toHaveBeenCalledWith(itinerary);
    expect(result.current.showDraftRecovery).toBe(false);
  });

  it("discards a draft that is already one of the planner's trips", async () => {
    savedTripOf.mockResolvedValue("trip-saved-before");
    stored.set("mt_pending_claim_token", "token");
    stored.set("mt_pending_claim_meta", JSON.stringify({ tripId: "trip-shared", shareToken: "s", shareUrl: "https://x/s" }));
    const { result } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props({ isAuthenticated: true, authUser: user }) });
    await waitFor(() => expect(clearDraft).toHaveBeenCalledTimes(1));
    expect(result.current.draftAutoRestored).toBe(false);
    expect(draftTargets.setGeneratedItinerary).not.toHaveBeenCalled();
  });

  it("puts back the plan this browser shared, though signing in already made it their trip", async () => {
    savedTripOf.mockResolvedValue("trip-shared");
    stored.set("mt_pending_claim_token", "token");
    stored.set("mt_pending_claim_meta", JSON.stringify({ tripId: "trip-shared", shareToken: "s", shareUrl: "https://x/s" }));
    const { result } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props({ isAuthenticated: true, authUser: user }) });
    await waitFor(() => expect(result.current.draftAutoRestored).toBe(true));
    expect(draftTargets.setGeneratedItinerary).toHaveBeenCalledWith(itinerary);
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("puts back the plan just claimed in this tab", async () => {
    savedTripOf.mockResolvedValue("trip-shared");
    sessionStorage.setItem("mt_claimed_trip_id", "trip-shared");
    const { result } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props({ isAuthenticated: true, authUser: user }) });
    await waitFor(() => expect(result.current.draftAutoRestored).toBe(true));
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("resumes the generation a planner signed up to finish, once", async () => {
    stored.set("pendingTripGeneration", "true");
    const formOnly = { ...fullDraft, generatedItinerary: null as unknown as GeneratedItinerary };
    const form = { destination: "Lisbon, Portugal", startDate: "2027-05-10", endDate: "2027-05-11", selectedVibes: ["foodie" as const] };
    const { result, rerender } = renderHook((p: Props) => useDraftRestore(p), {
      initialProps: props({ draft: formOnly, isAuthenticated: true, authUser: user }),
    });
    await waitFor(() => expect(result.current.draftAutoRestored).toBe(true));
    vi.useFakeTimers();
    rerender(props({ draft: formOnly, isAuthenticated: true, authUser: user, ...form }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(handleGenerate).toHaveBeenCalledTimes(1);
    expect(stored.has("pendingTripGeneration")).toBe(false);
  });

  it("doesn't start the next plan by itself after bringing back the one signed up for", async () => {
    stored.set("pendingTripGeneration", "true");
    const signedIn = { isAuthenticated: true, authUser: user };
    const { result, rerender } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props(signedIn) });
    await waitFor(() => expect(result.current.draftAutoRestored).toBe(true));
    await waitFor(() => expect(stored.has("pendingTripGeneration")).toBe(false));

    // Start Over clears the plan and the draft; then a new form, filled in.
    vi.useFakeTimers();
    rerender(props({ ...signedIn, hasDraft: false, draft: null, ...{ destination: "Rome, Italy", startDate: "2027-06-01", endDate: "2027-06-03", selectedVibes: ["cultural" as const] } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(handleGenerate).not.toHaveBeenCalled();
  });

  it("forgets the wish when the plan signed up for turns out to be saved already", async () => {
    stored.set("pendingTripGeneration", "true");
    savedTripOf.mockResolvedValue("trip-1");
    let answer!: () => void;
    prefsAnswer = new Promise((resolve) => (answer = resolve));
    renderHook((p: Props) => useDraftRestore(p), { initialProps: props({ isAuthenticated: true, authUser: user }) });
    await waitFor(() => expect(savedTripOf).toHaveBeenCalled());
    await act(() => vi.waitFor(() => Promise.resolve()));
    answer();
    await waitFor(() => expect(clearDraft).toHaveBeenCalled());
    await waitFor(() => expect(stored.has("pendingTripGeneration")).toBe(false));
  });

  it("reports an expired draft once", () => {
    const { rerender } = renderHook((p: Props) => useDraftRestore(p), { initialProps: props({ hasDraft: false, draft: null, isExpired: true }) });
    rerender(props({ hasDraft: false, draft: null, isExpired: true, locale: "en" }));
    expect(trackWizardEvent.mock.calls.filter(([step]) => step === "draft_expired")).toEqual([["draft_expired", { locale: "en" }]]);
  });
});
