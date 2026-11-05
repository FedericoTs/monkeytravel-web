/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { FRESH_ANSWERS } from "@/lib/wizard/answers";
import { DEFAULT_RETRY_DELAYS_MS } from "@/hooks/useAutoSaveTrip";
import type { GeneratedItinerary } from "@/types";
import { useWizardSave } from "./useWizardSave";

/**
 * Saving the wizard's plan, through the real auto-save hook: the Save button's
 * guards, the account wall, the manual save, the auto-save's wiring, and that a
 * trip that didn't save is never silent.
 */

const auth = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null, loading: false }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next-intl", () => ({ useLocale: () => "it" }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/i18n/routing", () => ({ useRouter: () => ({ push }) }));
const posthogCapture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posthog", () => ({ usePostHog: () => ({ capture: posthogCapture }) }));
const events = vi.hoisted(() => ({
  captureAutoSaveSkipped: vi.fn(),
  captureSaveBlockedAnon: vi.fn(),
  captureSaveFailed: vi.fn(),
  captureTripUpdated: vi.fn(),
}));
vi.mock("@/lib/posthog/events", () => events);
const trackWizardEvent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/components/wizard/wizardEvents", () => ({ trackWizardEvent }));
const sentryException = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/sentry", () => ({ sentryException }));
const safeSet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/safe-storage", () => ({ safeSet }));
const reportTripSaved = vi.hoisted(() => vi.fn());
vi.mock("@/lib/wizard/trip-saved", () => ({ reportTripSaved }));
const writes = vi.hoisted(() => ({
  saveTrip: vi.fn(),
  saveTripManually: vi.fn(),
  updateTrip: vi.fn(),
  deleteTrip: vi.fn(),
  attachCoverImage: vi.fn(),
}));
const wizardTripWrites = vi.hoisted(() => vi.fn((_mountId: string) => writes));
vi.mock("@/lib/trips/wizard-trip-writes", () => ({ newWizardMountId: () => "mount-1", wizardTripWrites }));

const answers = {
  ...FRESH_ANSWERS,
  destination: "Paris, France",
  startDate: "2027-05-10",
  endDate: "2027-05-12",
  tripIntent: "friends",
  travelStyle: "backpacker",
  anchors: [{ id: "a1" }],
} as unknown as typeof FRESH_ANSWERS;
const traits = { destination: "Paris, France", group_size: "friends", backpacker_mode: true };
const funnelRow = { ...traits, locale: "it" };
const newPlan = () => ({ days: [{ day_number: 1, activities: [] }] }) as unknown as GeneratedItinerary;

type Inputs = Partial<Omit<Parameters<typeof useWizardSave>[0], "savedTripId" | "setSavedTripId">>;
const clearDraft = vi.fn();
const openKeepAuth = vi.fn();
const setLoading = vi.fn();
const setError = vi.fn();

function show(inputs: Inputs = {}, savedAtFirst: string | null = null) {
  const first = {
    autoSaveEnabled: true,
    generatedItinerary: newPlan() as GeneratedItinerary | null,
    answers,
    derivedInterests: ["food"],
    deferAutoSave: false,
    adoptedTripId: null,
    awaitingTwinChoice: false,
    replaceTripId: null,
    draftAutoRestored: false,
    clearDraft,
    openKeepAuth,
    setLoading,
    setError,
    ...inputs,
  };
  const hook = renderHook(
    (props) => {
      const [savedTripId, setSavedTripId] = useState(savedAtFirst);
      return { savedTripId, setSavedTripId, ...useWizardSave({ ...props, savedTripId, setSavedTripId }) };
    },
    { initialProps: first }
  );
  return {
    first,
    now: () => hook.result.current,
    rerender: (more: Inputs) => hook.rerender({ ...first, ...more }),
  };
}

/** Lets what's in flight settle, retries' waits included when given. */
const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const allRetries = DEFAULT_RETRY_DELAYS_MS.reduce((sum, wait) => sum + wait, 0);
/** A write that waits for its answer. */
function held<T>() {
  let answer: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (answer = resolve));
  return { promise, answer: (value: T) => answer(value) };
}
const tapped = (step: string) => trackWizardEvent.mock.calls.filter((call) => (call as unknown[])[0] === step);

beforeEach(() => {
  vi.useFakeTimers();
  auth.user = { id: "user-1" };
  auth.loading = false;
  writes.saveTrip.mockResolvedValue({ tripId: "auto-1", durationDays: 3 });
  writes.saveTripManually.mockResolvedValue({ tripId: "manual-1", durationDays: 3 });
  writes.updateTrip.mockResolvedValue(undefined);
  writes.deleteTrip.mockResolvedValue(undefined);
  writes.attachCoverImage.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("the Save button, signed out", () => {
  beforeEach(() => {
    auth.user = null;
  });

  it("opens the account wall and saves nothing", async () => {
    const { now } = show();
    await act(() => now().handleSaveTrip());
    expect(openKeepAuth).toHaveBeenCalledExactlyOnceWith("wizard_save");
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("reports the tap with the plan's length, and that the wall stopped it", async () => {
    const { now } = show();
    await act(() => now().handleSaveTrip());
    expect(tapped("save_clicked")).toEqual([["save_clicked", { ...funnelRow, duration_days: 3 }]]);
    expect(tapped("save_blocked_anon")).toEqual([["save_blocked_anon", funnelRow]]);
    expect(events.captureSaveBlockedAnon).toHaveBeenCalledWith({ ...traits, modal_shown: true });
  });

  it("isn't left busy, so the wall can be reached again", async () => {
    const { now } = show();
    await act(() => now().handleSaveTrip());
    expect(setLoading).toHaveBeenLastCalledWith(false);
    await act(() => now().handleSaveTrip());
    expect(openKeepAuth).toHaveBeenCalledTimes(2);
  });
});

describe("Keep on a plan this browser shared, signed out", () => {
  it("is the same wall, reported the same way, under its own name", async () => {
    auth.user = null;
    const { now } = show();
    act(() => now().handleKeepSharedTrip());
    expect(openKeepAuth).toHaveBeenCalledExactlyOnceWith("anon_share_keep");
    expect(tapped("save_clicked")).toEqual([["save_clicked", funnelRow]]);
    expect(tapped("save_blocked_anon")).toEqual([["save_blocked_anon", funnelRow]]);
    expect(events.captureSaveBlockedAnon).toHaveBeenCalledWith({ ...traits, modal_shown: true });
  });
});

describe("the Save button does nothing", () => {
  it("with no plan on screen", async () => {
    const { now } = show({ generatedItinerary: null, autoSaveEnabled: false });
    await act(() => now().handleSaveTrip());
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    expect(trackWizardEvent).not.toHaveBeenCalled();
  });

  it("once the auto-save has stored the trip", async () => {
    const { now } = show();
    await settle();
    expect(now().autoSave.savedTripId).toBe("auto-1");
    await act(() => now().handleSaveTrip());
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    expect(tapped("save_clicked")).toEqual([]);
  });

  it("while a shared plan's claim is saving it", async () => {
    const { now } = show({ deferAutoSave: true });
    expect(now().claimingSharedPlan).toBe(true);
    await act(() => now().handleSaveTrip());
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    expect(tapped("save_clicked")).toEqual([]);
  });

  it("for a second tap while the first is saving", async () => {
    const answer = held<{ tripId: string; durationDays: number }>();
    writes.saveTripManually.mockReturnValue(answer.promise);
    const { now } = show({ autoSaveEnabled: false });
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = now().handleSaveTrip();
    });
    await act(() => now().handleSaveTrip());
    expect(writes.saveTripManually).toHaveBeenCalledTimes(1);
    expect(tapped("save_clicked")).toHaveLength(1);
    await act(async () => {
      answer.answer({ tripId: "manual-1", durationDays: 3 });
      await first;
    });
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe("the Save button while the same trip's prompt is open", () => {
  it("takes the planner to the prompt, and inserts no copy behind it", async () => {
    document.body.innerHTML = `<div data-twin-trip-prompt><button>Keep both</button></div>`;
    const prompt = document.querySelector<HTMLElement>("[data-twin-trip-prompt]")!;
    prompt.scrollIntoView = vi.fn();
    const { now } = show({ awaitingTwinChoice: true });
    await act(() => now().handleSaveTrip());
    expect(prompt.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(prompt.querySelector("button"));
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    expect(writes.saveTrip).not.toHaveBeenCalled();
  });
});

describe("the Save button, signed in, with the auto-save off", () => {
  it("inserts the plan with every answer, for this user", async () => {
    const plan = newPlan();
    const { now } = show({ autoSaveEnabled: false, generatedItinerary: plan });
    await act(() => now().handleSaveTrip());
    expect(writes.saveTripManually).toHaveBeenCalledExactlyOnceWith(
      { itinerary: plan, formState: { ...answers, derivedInterests: ["food"], locale: "it" } },
      "user-1"
    );
  });

  it("shows it is busy only while it saves", async () => {
    const answer = held<{ tripId: string; durationDays: number }>();
    writes.saveTripManually.mockReturnValue(answer.promise);
    const { now } = show({ autoSaveEnabled: false });
    let tap: Promise<void> = Promise.resolve();
    act(() => {
      tap = now().handleSaveTrip();
    });
    expect(setLoading).toHaveBeenLastCalledWith(true);
    await act(async () => {
      answer.answer({ tripId: "manual-1", durationDays: 3 });
      await tap;
    });
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("then attaches a cover, reports the save once, forgets the draft, and opens the trip", async () => {
    const { now } = show({ autoSaveEnabled: false });
    await act(() => now().handleSaveTrip());
    expect(writes.attachCoverImage).toHaveBeenCalledWith("manual-1", "Paris, France");
    expect(reportTripSaved).toHaveBeenCalledExactlyOnceWith(
      {
        tripId: "manual-1",
        durationDays: 3,
        destination: "Paris, France",
        budgetTier: answers.budgetTier,
        tripIntent: "friends",
        travelStyle: "backpacker",
        anchorCount: 1,
        locale: "it",
      },
      "Trip Save"
    );
    expect(clearDraft).toHaveBeenCalled();
    expect(safeSet).toHaveBeenCalledWith("profile_modal_shown", "true", "session");
    expect(now().savedTripId).toBe("manual-1");
    expect(push).toHaveBeenCalledExactlyOnceWith("/trips/manual-1");
  });

  it("when it fails says why, reports it everywhere, stays on the plan, and can be tried again", async () => {
    writes.saveTripManually.mockRejectedValueOnce(new Error("permission denied for rls policy"));
    const { now } = show({ autoSaveEnabled: false });
    await act(() => now().handleSaveTrip());
    expect(setError).toHaveBeenCalledWith("permission denied for rls policy");
    expect(push).not.toHaveBeenCalled();
    expect(now().savedTripId).toBeNull();
    expect(sentryException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { feature: "manual_save", arm: "manual", error_class: "rls" },
      extra: { destination: "Paris, France" },
    });
    expect(tapped("save_failed")).toEqual([["save_failed", funnelRow]]);
    expect(events.captureSaveFailed).toHaveBeenCalledWith({
      ...traits,
      error_class: "rls",
      error_message: "permission denied for rls policy",
      arm: "manual",
    });
    expect(setLoading).toHaveBeenLastCalledWith(false);

    await act(() => now().handleSaveTrip());
    expect(push).toHaveBeenCalledExactlyOnceWith("/trips/manual-1");
  });

  it("a failure with no message still says something, and PostHog gets a short message or none", async () => {
    writes.saveTripManually.mockRejectedValueOnce("broken");
    const { now } = show({ autoSaveEnabled: false });
    await act(() => now().handleSaveTrip());
    expect(setError).toHaveBeenCalledWith("Failed to save trip");
    expect(events.captureSaveFailed.mock.calls[0][0]).toMatchObject({ error_class: "unknown", error_message: undefined });

    writes.saveTripManually.mockRejectedValueOnce(new Error("x".repeat(200)));
    await act(() => now().handleSaveTrip());
    expect(events.captureSaveFailed.mock.calls[1][0].error_message).toHaveLength(80);
  });
});

describe("the auto-save, signed in", () => {
  it("inserts the plan on its own, with every answer, and stays on the page", async () => {
    const plan = newPlan();
    const { now } = show({ generatedItinerary: plan });
    await settle();
    expect(writes.saveTrip).toHaveBeenCalledExactlyOnceWith({
      itinerary: plan,
      formState: { ...answers, derivedInterests: ["food"], locale: "it" },
    });
    expect(writes.attachCoverImage).toHaveBeenCalledWith("auto-1", "Paris, France");
    expect(reportTripSaved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tripId: "auto-1" }), "Auto-save");
    expect(clearDraft).toHaveBeenCalled();
    expect(now().savedTripId).toBe("auto-1");
    expect(push).not.toHaveBeenCalled();
  });

  it("reports a save that waited with the answers as they are when it starts", async () => {
    const later = { ...answers, tripIntent: "family" as typeof answers.tripIntent };
    const { first, rerender } = show({ awaitingTwinChoice: true });
    await settle();
    rerender({ awaitingTwinChoice: true, answers: later, generatedItinerary: first.generatedItinerary });
    await settle();
    expect(writes.saveTrip).not.toHaveBeenCalled();
    rerender({ awaitingTwinChoice: false, answers: later, generatedItinerary: first.generatedItinerary });
    await settle();
    expect(writes.saveTrip.mock.calls[0][0].formState).toMatchObject({ tripIntent: "family" });
    expect(reportTripSaved.mock.calls[0][0]).toMatchObject({ tripIntent: "family" });
  });

  it("updates the same trip for a new plan, without counting another first save", async () => {
    const { rerender } = show();
    await settle();
    rerender({ generatedItinerary: newPlan() });
    await settle();
    expect(writes.saveTrip).toHaveBeenCalledTimes(1);
    expect(writes.updateTrip).toHaveBeenCalledWith("auto-1", expect.anything());
    expect(reportTripSaved).toHaveBeenCalledTimes(1);
    expect(events.captureTripUpdated).toHaveBeenCalledExactlyOnceWith({
      trip_id: "auto-1",
      destination: "Paris, France",
      duration_days: 3,
      budget_tier: answers.budgetTier,
      is_from_template: false,
    });
  });

  it("when every retry fails reports it everywhere, with how many tries it took", async () => {
    writes.saveTrip.mockRejectedValue(new Error("network down"));
    const { now } = show();
    await settle(allRetries);
    expect(writes.saveTrip).toHaveBeenCalledTimes(3);
    expect(sentryException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { feature: "auto_save", arm: "auto", error_class: "network" },
      extra: { attempts: 3, destination: "Paris, France" },
    });
    expect(tapped("save_failed")).toEqual([["save_failed", funnelRow]]);
    expect(events.captureSaveFailed).toHaveBeenCalledWith({
      ...traits,
      error_class: "network",
      error_message: "network down",
      arm: "auto",
      attempts: 3,
    });
    expect(console.error).toHaveBeenCalled();
    expect(now().autoSave.status).toBe("error");
    expect(now().isUnsaved).toBe(true);
  });

  it("after that, the Save button can still save the plan", async () => {
    writes.saveTrip.mockRejectedValue(new Error("network down"));
    const { now } = show();
    await settle(allRetries);
    await act(() => now().handleSaveTrip());
    expect(writes.saveTripManually).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledExactlyOnceWith("/trips/manual-1");
  });

  it("adopts a claimed trip instead of inserting a copy", async () => {
    const { now } = show({ adoptedTripId: "claimed-1" });
    await settle();
    expect(writes.saveTrip).not.toHaveBeenCalled();
    expect(now().savedTripId).toBe("claimed-1");
    expect(now().isUnsaved).toBe(false);
  });

  it("takes a trip the page before it saved this plan to: no write, and the save is reported", async () => {
    const { now, rerender } = show({ planHeldBy: "held-1" });
    await settle();
    expect(writes.saveTrip).not.toHaveBeenCalled();
    expect(writes.updateTrip).not.toHaveBeenCalled();
    expect(now().savedTripId).toBe("held-1");
    expect(now().isUnsaved).toBe(false);
    expect(reportTripSaved).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tripId: "held-1", durationDays: 3, destination: "Paris, France" }),
      "Auto-save"
    );
    expect(clearDraft).toHaveBeenCalledTimes(1);

    // The check goes quiet once the trip is saved; nothing happens again.
    rerender({ planHeldBy: null });
    await settle();
    expect(writes.saveTrip).not.toHaveBeenCalled();
    expect(now().savedTripId).toBe("held-1");
    expect(reportTripSaved).toHaveBeenCalledTimes(1);
  });

  it("updates the trip the planner chose to replace, instead of inserting", async () => {
    const { now } = show({ replaceTripId: "older-1" });
    await settle();
    expect(writes.saveTrip).not.toHaveBeenCalled();
    expect(writes.updateTrip).toHaveBeenCalledWith("older-1", expect.anything());
    expect(now().savedTripId).toBe("older-1");
  });

  it("deletes what it saved when the plan is discarded, and the trip id goes with it", async () => {
    const { now } = show();
    await settle();
    await act(() => now().autoSave.discard());
    await settle();
    expect(writes.deleteTrip).toHaveBeenCalledWith("auto-1");
    expect(now().savedTripId).toBeNull();
    expect(now().isUnsaved).toBe(true);
  });
});

describe("a plan the auto-save skips is reported, with why", () => {
  it.each([
    ["signed out", { user: null, loading: false }, {}, "not_authenticated"],
    ["while sign-in is still being read", { user: null, loading: true }, {}, "auth_pending"],
    ["switched off", { user: { id: "u" }, loading: false }, { autoSaveEnabled: false }, "disabled"],
    ["waiting for a claim", { user: { id: "u" }, loading: false }, { deferAutoSave: true }, "pending_claim"],
    ["waiting for the planner's choice", { user: { id: "u" }, loading: false }, { awaitingTwinChoice: true }, "pending_choice"],
  ] as const)("%s", async (_name, signedIn, inputs, reason) => {
    auth.user = signedIn.user;
    auth.loading = signedIn.loading;
    show(inputs);
    await settle();
    expect(writes.saveTrip).not.toHaveBeenCalled();
    expect(events.captureAutoSaveSkipped).toHaveBeenCalledExactlyOnceWith({ reason, destination: "Paris, France" });
  });
});

describe("what the bars read", () => {
  it.each([
    ["signed in, auto-save on", { user: { id: "u" }, loading: false }, {}, true, false],
    ["signed out", { user: null, loading: false }, {}, false, false],
    ["sign-in still being read", { user: null, loading: true }, {}, false, false],
    ["auto-save off", { user: { id: "u" }, loading: false }, { autoSaveEnabled: false }, false, false],
    ["a claim running", { user: { id: "u" }, loading: false }, { deferAutoSave: true }, false, true],
    ["a claim waiting for sign-in", { user: null, loading: false }, { deferAutoSave: true }, false, false],
    ["the planner's choice open", { user: { id: "u" }, loading: false }, { awaitingTwinChoice: true }, false, false],
  ] as const)("%s", async (_name, signedIn, inputs, autoSaving, claiming) => {
    auth.user = signedIn.user;
    auth.loading = signedIn.loading;
    const { now } = show(inputs);
    await settle();
    expect(now().autoSaving).toBe(autoSaving);
    expect(now().claimingSharedPlan).toBe(claiming);
  });

  it("the save isn't called under way once it has failed", async () => {
    writes.saveTrip.mockRejectedValue(new Error("network down"));
    const { now } = show();
    await settle(allRetries);
    expect(now().autoSaving).toBe(false);
  });

  it("a trip saved by another way counts as saved", () => {
    const { now } = show({ autoSaveEnabled: false }, "claimed-1");
    expect(now().isUnsaved).toBe(false);
    expect(now().savedTripId).toBe("claimed-1");
  });
});

describe("a Save made before signing up, with the auto-save switched off", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AUTO_SAVE_FORCE", "off");
  });
  const restored = { autoSaveEnabled: false, draftAutoRestored: true };

  it("is completed once the draft comes back signed in, and counted", async () => {
    show(restored);
    await settle();
    expect(writes.saveTripManually).toHaveBeenCalledTimes(1);
    expect(posthogCapture).toHaveBeenCalledExactlyOnceWith("save_intent_redeemed", funnelRow);
    expect(push).toHaveBeenCalledWith("/trips/manual-1");
  });

  it("only once", async () => {
    writes.saveTripManually.mockRejectedValue(new Error("network down"));
    const { rerender } = show(restored);
    await settle();
    rerender({ ...restored, generatedItinerary: newPlan() });
    await settle();
    expect(writes.saveTripManually).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["without a restored draft", { autoSaveEnabled: false }],
    ["without a plan", { ...restored, generatedItinerary: null }],
  ])("isn't completed %s", async (_name, inputs) => {
    show(inputs);
    await settle();
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it("is still owed when the plan comes back after the draft's flag", async () => {
    const { rerender } = show({ ...restored, generatedItinerary: null });
    await settle();
    rerender({ ...restored, generatedItinerary: newPlan() });
    await settle();
    expect(writes.saveTripManually).toHaveBeenCalledTimes(1);
  });

  it("isn't completed for a trip already saved", async () => {
    show(restored, "saved-1");
    await settle();
    expect(writes.saveTripManually).not.toHaveBeenCalled();
  });

  it("isn't completed signed out", async () => {
    auth.user = null;
    show(restored);
    await settle();
    expect(openKeepAuth).not.toHaveBeenCalled();
    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it("waits for sign-in to be read, then completes", async () => {
    auth.user = null;
    auth.loading = true;
    const { first, rerender } = show(restored);
    await settle();
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    auth.user = { id: "user-1" };
    auth.loading = false;
    rerender({ ...restored, generatedItinerary: first.generatedItinerary });
    await settle();
    expect(writes.saveTripManually).toHaveBeenCalledTimes(1);
  });
});

describe("with the auto-save on", () => {
  it("a restored draft is left to the auto-save, so it can't be saved twice", async () => {
    show({ draftAutoRestored: true });
    await settle();
    expect(writes.saveTrip).toHaveBeenCalledTimes(1);
    expect(writes.saveTripManually).not.toHaveBeenCalled();
    expect(posthogCapture).not.toHaveBeenCalled();
  });
});

describe("one wizard mount", () => {
  it("keeps one set of writes across renders, so every trip it inserts carries one mount id", async () => {
    const { first, rerender } = show();
    rerender({ generatedItinerary: first.generatedItinerary });
    rerender({ generatedItinerary: first.generatedItinerary });
    await settle();
    expect(wizardTripWrites).toHaveBeenCalledExactlyOnceWith("mount-1");
  });
});
