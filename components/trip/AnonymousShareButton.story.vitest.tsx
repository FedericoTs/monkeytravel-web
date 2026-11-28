/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import AnonymousShareButton from "./AnonymousShareButton";
import type { Experiment } from "@/lib/experiments/registry";
import type { Assignment } from "@/lib/experiments/assign";

/**
 * story_way_in: a planner sharing a plan is also offered its story for friends who aren't coming (a guess to play),
 * after everything the share already offers. Counted when the panel shows a link, where the arms first differ.
 * The exposure is recorded once per page, and a page here is a test.
 */

const SHARE_URL = "https://monkeytravel.app/shared/11111111-2222-4333-8444-555555555555";
const TOKEN = "11111111-2222-4333-8444-555555555555";
const copy = enTrips.wizard.result;

vi.mock("@/lib/posthog/events", () => ({
  captureAnonShareClicked: async () => {},
  captureAnonShareCreated: async () => {},
  captureAnonShareFailed: async () => {},
  captureAnonShareKeepClicked: async () => {},
  captureAnonShareCopied: async () => {},
  captureAnonShareSent: async () => {},
  captureStoryWayInOpened: async () => {},
}));
// One page per test: each test gets a fresh "recorded once" memory, through the real reporter.
const holder = vi.hoisted(() => ({ report: (_experiment: unknown, _assignment: unknown): void => {} }));
vi.mock("@/lib/experiments/exposure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experiments/exposure")>();
  return { ...actual, createExposureReporter: () => (experiment: unknown, assignment: unknown) => holder.report(experiment, assignment) };
});
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

const panelOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-share-panel]");
const storyLink = () => screen.queryByRole("link", { name: enCommon.story.wayIn.cta });
const exposures = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/experiments/exposure").map(([, init]) => JSON.parse(String(init?.body)));

async function renderButton(more: Record<string, unknown> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ trips: enTrips, common: enCommon }}>
      <AnonymousShareButton trip={trip} mode="share" panel="below" onKeep={() => {}} {...more} />
    </NextIntlClientProvider>,
  );
}

async function openPanel(more: Record<string, unknown> = {}) {
  const view = await renderButton(more);
  fireEvent.click(screen.getByRole("button", { name: copy.shareAnonCta }));
  await waitFor(() => expect(panelOf(view.container)).not.toBeNull());
  return view;
}

/** A browser that drew the story arm, after the draw started. */
function drewStory() {
  vi.stubEnv("NEXT_PUBLIC_EXP_STORY_WAY_IN", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
  window.localStorage.setItem("mt_exp_story_way_in_arm", "story");
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("@/lib/experiments/exposure")>("@/lib/experiments/exposure");
  const report = actual.createExposureReporter({ post: (url, init) => fetch(url, init), onPostHog: () => {} });
  holder.report = (experiment, assignment) => report(experiment as Experiment, assignment as Assignment);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
  Reflect.deleteProperty(navigator, "share");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tallies: {} }))));
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

describe("AnonymousShareButton and the trip's story", () => {
  it("in the story arm, ends the panel with the way to this link's story, in a new tab", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXP_STORY_WAY_IN", "story");
    const { container } = await openPanel();
    const link = storyLink();
    expect(link?.getAttribute("href")).toBe(`/shared/${TOKEN}/story`);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(enCommon.story.wayIn.note)).toBeTruthy();
    // After the ask to keep the plan, never above it.
    const panel = panelOf(container)!;
    const keep = panel.querySelector("[data-anon-share-keep]")!;
    const story = panel.querySelector('[data-story-way-in="planner"]')!;
    expect(keep.compareDocumentPosition(story) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("in today's arm, the panel is as it was", async () => {
    await openPanel();
    expect(storyLink()).toBeNull();
  });

  it("records a counted browser once, when the link is shown", async () => {
    drewStory();
    await openPanel();
    expect(storyLink()).toBeTruthy();
    await waitFor(() => expect(exposures()).toEqual([{ experiment: "story_way_in", arm: "story" }]));
    fireEvent.click(screen.getByRole("button", { name: enCommon.buttons.close }));
    fireEvent.click(screen.getByRole("button", { name: copy.shareAnonCta }));
    await waitFor(() => expect(screen.getByDisplayValue(SHARE_URL)).toBeTruthy());
    expect(exposures()).toHaveLength(1);
  });

  it("records nothing before a link is shown", async () => {
    drewStory();
    await renderButton();
    expect(exposures()).toEqual([]);
  });

  it("with a link made before, records nothing until its panel opens", async () => {
    drewStory();
    const { container } = await renderButton({ existingShareUrl: SHARE_URL });
    expect(panelOf(container)).toBeNull();
    expect(exposures()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: copy.shareAnonCta }));
    await waitFor(() => expect(panelOf(container)).not.toBeNull());
    await waitFor(() => expect(exposures()).toEqual([{ experiment: "story_way_in", arm: "story" }]));
  });

  it("shows a link's chosen arm without counting it", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXP_STORY_WAY_IN", "");
    window.localStorage.setItem("mt_exp_story_way_in_chosen", "story");
    await openPanel();
    expect(storyLink()).toBeTruthy();
    expect(exposures()).toEqual([]);
  });
});
