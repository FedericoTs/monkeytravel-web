/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StoryPost from "./StoryPost";

/**
 * The story's pictures for the one telling the trip. A phone opens its share sheet only for a tap that
 * already has the file, so each picture is fetched when this shows and its button waits for it; the link is
 * copied in the same press; and a post is counted only when it happened.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const TRIP = "99999999-2222-4333-8444-555555555555";
const URL_OF = (picture: string) => `/api/og/trip?token=${TOKEN}&format=${picture}&locale=en`;

const state = vi.hoisted(() => ({
  outcome: "shared" as "shared" | "downloaded" | "cancelled",
  shared: [] as File[],
  copied: [] as string[],
  captured: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/native/share", () => ({
  shareFile: async (file: File) => {
    state.shared.push(file);
    return state.outcome;
  },
  copyToClipboard: async (text: string) => {
    state.copied.push(text);
    return true;
  },
}));
vi.mock("@/lib/posthog/client", () => ({
  onPostHogReady: (fn: (posthog: { capture: (event: string, properties: Record<string, unknown>) => void }) => void) =>
    fn({ capture: (event, properties) => state.captured.push([event, properties]) }),
}));

/** The pictures the server answers with: a promise per address, so a test decides when each arrives. */
let pictures: Record<string, { resolve: (res: Response) => void }>;
let asked: string[];
let posted: Array<Record<string, unknown>>;

// jsdom's Blob can't be read back out of a Response, so the answer is the two things the code reads from one.
const arrive = (picture: string, ok = true) =>
  pictures[URL_OF(picture)].resolve({ ok, status: ok ? 200 : 500, blob: async () => new Blob(["png"], { type: "image/png" }) } as Response);

const view = (withGuess = true) =>
  render(<StoryPost shareToken={TOKEN} locale="en" tripId={TRIP} withGuess={withGuess} storyUrl="https://monkeytravel.app/shared/abc/story" fileStem="lisbon" />);

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  state.outcome = "shared";
  state.shared = [];
  state.copied = [];
  state.captured = [];
  pictures = {};
  asked = [];
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { body?: string }) => {
      if (url === "/api/funnel-event") {
        posted.push(JSON.parse(init?.body ?? "{}"));
        return Promise.resolve(new Response("{}"));
      }
      asked.push(url);
      return new Promise<Response>((resolve) => {
        pictures[url] = { resolve };
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the pictures to post", () => {
  it("are asked for as soon as they show: the guess and its answer, in the reader's language", () => {
    view();
    expect(asked).toEqual([URL_OF("guess"), URL_OF("place")]);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect([...document.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([URL_OF("guess"), URL_OF("place")]);
  });

  it("can't be pressed until each has arrived", async () => {
    view();
    expect(screen.getAllByRole("button", { name: "post.preparing" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    arrive("guess");
    await waitFor(() => expect(button("post.guess").disabled).toBe(false));
    expect(screen.getAllByRole("button", { name: "post.preparing" })).toHaveLength(1);
    arrive("place");
    await waitFor(() => expect(button("post.place").disabled).toBe(false));
  });

  it("is only the trip, for a story that asks no guess", async () => {
    view(false);
    expect(asked).toEqual([URL_OF("place")]);
    arrive("place");
    await waitFor(() => expect(button("post.trip").disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "post.place" })).toBeNull();
  });
});

describe("posting one", () => {
  const ready = async () => {
    view();
    arrive("guess");
    arrive("place");
    await waitFor(() => expect(button("post.place").disabled).toBe(false));
  };

  it("hands the picture to the share sheet, copies the link in the same press, and counts the post", async () => {
    await ready();
    fireEvent.click(button("post.guess"));
    await screen.findByText("post.shared");
    expect(state.shared.map((file) => [file.name, file.type])).toEqual([["lisbon-guess.png", "image/png"]]);
    expect(state.copied).toEqual(["https://monkeytravel.app/shared/abc/story"]);
    expect(posted).toEqual([{ event_type: "trip_card_shared", trip_id: TRIP, format: "guess", method: "native_share" }]);
    expect(state.captured).toEqual([["story_posted", { picture: "guess", method: "native_share" }]]);
  });

  it("posts the answer as its own picture", async () => {
    await ready();
    fireEvent.click(button("post.place"));
    await screen.findByText("post.shared");
    expect(state.shared[0].name).toBe("lisbon-place.png");
    expect(posted[0]).toMatchObject({ format: "place" });
  });

  it("says where the picture went when the browser could only save it, and counts it as saved", async () => {
    state.outcome = "downloaded";
    await ready();
    fireEvent.click(button("post.guess"));
    await screen.findByText("post.saved");
    expect(posted).toEqual([{ event_type: "trip_card_shared", trip_id: TRIP, format: "guess", method: "download" }]);
  });

  it("counts nothing and says nothing when the share sheet is closed", async () => {
    state.outcome = "cancelled";
    await ready();
    fireEvent.click(button("post.guess"));
    await waitFor(() => expect(state.shared).toHaveLength(1));
    expect(posted).toEqual([]);
    expect(state.captured).toEqual([]);
    expect(screen.queryByText("post.shared")).toBeNull();
    expect(screen.queryByText("post.saved")).toBeNull();
  });
});

describe("a picture that can't be made", () => {
  it("is said, keeps its button off, and leaves the other one working", async () => {
    view();
    arrive("guess", false);
    arrive("place");
    await screen.findByText("post.failed");
    expect(button("post.guess").disabled).toBe(true);
    expect(button("post.place").disabled).toBe(false);
    fireEvent.click(button("post.guess"));
    expect(state.shared).toEqual([]);
  });
});
