/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchShareStatus, forgetShareStatus } from "./share-status";

const answer = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  forgetShareStatus();
  fetchMock = vi.fn(async () => answer({ isShared: true, shareUrl: "https://monkeytravel.app/shared/abc" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchShareStatus", () => {
  it("answers the page, ShareButton and the late-mounting prompt with one request", async () => {
    const [page, button] = await Promise.all([fetchShareStatus("t1"), fetchShareStatus("t1")]);
    const prompt = await fetchShareStatus("t1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/t1/share");
    expect(button).toEqual(page);
    expect(prompt).toEqual(page);
  });

  it("asks again for another trip, when told fresh, and after a share change", async () => {
    await fetchShareStatus("t1");
    await fetchShareStatus("t2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await fetchShareStatus("t1", { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    forgetShareStatus("t1");
    await fetchShareStatus("t1");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("asks again once the answer is older than the reuse window", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await fetchShareStatus("t1");
    now.mockReturnValue(1_000_000 + 9_000);
    await fetchShareStatus("t1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 11_000);
    await fetchShareStatus("t1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("answers null when the route refuses", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "Unauthorized" }, false));
    expect(await fetchShareStatus("t1")).toBeNull();
  });

  it("does not hand a failed request to later callers", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetchShareStatus("t1")).rejects.toThrow("Failed to fetch");
    expect(await fetchShareStatus("t1")).toEqual({ isShared: true, shareUrl: "https://monkeytravel.app/shared/abc" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * TripDetailClient is too large to render here, so its requests are checked in
 * the source, like lib/security/trips-itinerary-version.vitest.ts does.
 */
describe("the trip page's requests on load", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const TRIP_PAGE = "app/[locale]/(app)/trips/[id]/TripDetailClient.tsx";
  const READERS = [TRIP_PAGE, "components/trip/ShareButton.tsx", "components/trip/SharePromptOnTrip.tsx"];

  it("reads the share status through fetchShareStatus, never with its own GET", () => {
    for (const path of READERS) {
      const src = read(path);
      expect(src, path).toContain("fetchShareStatus(");
      // A fetch of the share URL with no options is a GET.
      expect(src, path).not.toMatch(/fetch\(`\/api\/trips\/\$\{[^}]+\}\/share`\)/);
    }
  });

  it("does not load the activity timeline it never shows", () => {
    expect(read(TRIP_PAGE)).not.toContain("useActivityTimeline(");
  });

  it("loads the checklist only in the phase that shows it", () => {
    expect(read(TRIP_PAGE)).toContain("useChecklist(trip.id, { enabled: isOwner && isPreTripPhase })");
  });
});
