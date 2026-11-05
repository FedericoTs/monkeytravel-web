import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A trip's card is cached by the CDN for a day under the trip's tag; the
 * routes that make its link stop resolving drop that tag, so a deleted,
 * unshared or unpublished trip doesn't keep its picture.
 */

const dangerouslyDeleteByTag = vi.fn<(tag: string) => Promise<void>>(async () => undefined);
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag }));

const { purgeTripCard, tripCardTag } = await import("./trip-card-cache");

beforeEach(() => dangerouslyDeleteByTag.mockClear());

describe("purgeTripCard", () => {
  it("uses the tag the trip's cards carry", () => {
    expect(tripCardTag("x")).toBe("trip-card-x");
  });

  it("drops the trip's tag", async () => {
    await purgeTripCard("trip-1");
    expect(dangerouslyDeleteByTag).toHaveBeenCalledWith("trip-card-trip-1");
  });

  it("never fails the request that triggered it", async () => {
    dangerouslyDeleteByTag.mockRejectedValueOnce(new Error("purge unavailable"));
    await expect(purgeTripCard("trip-1")).resolves.toBeUndefined();
  });
});
