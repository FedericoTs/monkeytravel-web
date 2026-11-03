import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { useTripCover } from "./useTripCover";

/**
 * The trip hero's cover: the stored one, else one the hero looks up, which
 * the owner's visit keeps and stores on the trip.
 */

type Props = Parameters<typeof useTripCover>[0];

const fetchMock = vi.fn(async () => new Response("{}"));

function setup(over: Partial<Props> = {}) {
  const props: Props = { tripId: "t1", storedUrl: null, isOwner: true, ...over };
  const view = renderHook((p: Props) => useTripCover(p), { initialProps: props });
  const lookedUp = (url: string) => act(async () => view.result.current.handleCoverImageFetched(url));
  return { props, view, lookedUp };
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useTripCover", () => {
  it("starts from the cover stored on the trip", () => {
    const { view } = setup({ storedUrl: "https://img/stored.jpg" });
    expect(view.result.current.coverImageUrl).toBe("https://img/stored.jpg");
  });

  it("on the owner's visit, keeps a looked-up photo and stores it on the trip", async () => {
    const { view, lookedUp } = setup();
    await lookedUp("https://img/a.jpg");
    expect(view.result.current.coverImageUrl).toBe("https://img/a.jpg");
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/t1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cover_image_url: "https://img/a.jpg" }),
    });
  });

  it("on anyone else's visit, keeps and stores nothing: the hero holds its own photo", async () => {
    const { view, lookedUp } = setup({ isOwner: false });
    await lookedUp("https://img/a.jpg");
    expect(view.result.current.coverImageUrl).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores an empty photo", async () => {
    const { view, lookedUp } = setup();
    await lookedUp("");
    expect(view.result.current.coverImageUrl).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes a newly stored cover, and the stored one again when the trip changes", async () => {
    const { props, view, lookedUp } = setup();
    view.rerender({ ...props, storedUrl: "https://img/stored-2.jpg" });
    expect(view.result.current.coverImageUrl).toBe("https://img/stored-2.jpg");
    await lookedUp("https://img/b.jpg");
    view.rerender({ ...props, storedUrl: "https://img/stored-2.jpg", tripId: "t2" });
    expect(view.result.current.coverImageUrl).toBe("https://img/stored-2.jpg");
  });

  it("keeps the photo for the visit when storing it fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { view, lookedUp } = setup();
    await lookedUp("https://img/a.jpg");
    expect(view.result.current.coverImageUrl).toBe("https://img/a.jpg");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the same handler while the trip and the owner stay", () => {
    const { props, view } = setup();
    const first = view.result.current.handleCoverImageFetched;
    view.rerender({ ...props });
    expect(view.result.current.handleCoverImageFetched).toBe(first);
  });
});
