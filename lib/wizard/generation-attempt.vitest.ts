/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreamHandlers } from "@/lib/streaming/client";
import type { SseCompleteData, SseDayData, SseMetadataData, SseOutlineData } from "@/lib/streaming/sse";
import { GENERATION_ID_HEADER } from "@/lib/ai/generation-id";
import { attemptGeneration, type GenerationAnswer } from "./generation-attempt";

/**
 * One try at a plan: the stream when the trip can stream, a plan the server
 * kept when a started stream was cut, then the JSON endpoint, whose own
 * failure is the only one that throws.
 */

type Itinerary = NonNullable<GenerationAnswer["itinerary"]>;
const streamedPlan = { days: [{ day_number: 1 }], tag: "streamed" } as unknown as Itinerary;
const jsonPlan = { days: [{ day_number: 1 }], tag: "json" } as unknown as Itinerary;
const keptPlan = { days: [{ day_number: 1 }], tag: "kept" } as unknown as Itinerary;

const progress = () => ({ reset: vi.fn(), total: vi.fn(), outline: vi.fn(), day: vi.fn() });
const request = (over: Partial<{ stream: boolean; signedIn: boolean }> = {}) => ({
  body: { destination: "Rome" },
  stream: true,
  signedIn: false,
  ...over,
});
const answer = (status: number, data: GenerationAnswer) => ({
  response: { ok: status >= 200 && status < 300, status } as Response,
  data,
});
/** A stream that plays `events` through the handlers, then closes. */
const streamPlaying = (events: (h: StreamHandlers) => void) =>
  vi.fn(async (_body: unknown, handlers: StreamHandlers, _opts?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    events(handlers);
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("attemptGeneration", () => {
  it("returns the streamed plan and reports its progress, without the JSON endpoint", async () => {
    const p = progress();
    const day = { day_number: 1, date: "2027-05-10" } as SseDayData;
    const outline = { days: [{ day_number: 1, theme: "t", area: "a", places: [] }] } as SseOutlineData;
    const stream = streamPlaying((h) => {
      h.onStart?.();
      h.onMetadata?.({ totalDays: 3 } as SseMetadataData);
      h.onOutline?.(outline);
      h.onDay?.(day);
      h.onComplete({ itinerary: streamedPlan } as SseCompleteData);
    });
    const postJson = vi.fn();
    const out = await attemptGeneration("gen-1", request(), p, { stream, postJson });
    expect(out).toEqual({ itinerary: streamedPlan });
    expect(p.reset).toHaveBeenCalledTimes(1);
    expect(p.total).toHaveBeenCalledWith(3);
    expect(p.outline).toHaveBeenCalledWith(outline.days);
    expect(p.day).toHaveBeenCalledWith(day);
    expect(postJson).not.toHaveBeenCalled();
    expect(stream.mock.calls[0][2]?.headers).toEqual({ [GENERATION_ID_HEADER]: "gen-1" });
  });

  it("falls back to the JSON endpoint when the stream fails before any data", async () => {
    const stream = vi.fn(async () => {
      throw new Error("429");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const recover = vi.fn();
    const postJson = vi.fn(async () => answer(200, { itinerary: jsonPlan }));
    const out = await attemptGeneration("gen-1", request(), progress(), { stream, recover, postJson });
    expect(out).toEqual({ itinerary: jsonPlan });
    expect(recover).not.toHaveBeenCalled();
    expect(postJson).toHaveBeenCalledWith("/api/ai/generate", { destination: "Rome" }, expect.objectContaining({ headers: { [GENERATION_ID_HEADER]: "gen-1" } }));
  });

  it("asks for the kept plan when a started stream ends without one", async () => {
    const stream = streamPlaying((h) => h.onStart?.());
    const recover = vi.fn(async () => ({ itinerary: keptPlan }));
    const postJson = vi.fn();
    const out = await attemptGeneration("gen-1", request(), progress(), { stream, recover, postJson });
    expect(out).toEqual({ itinerary: keptPlan });
    expect(recover).toHaveBeenCalledWith("gen-1", { attempts: 1 });
    expect(postJson).not.toHaveBeenCalled();
  });

  it("goes to the JSON endpoint when no kept plan comes back", async () => {
    const stream = streamPlaying((h) => h.onStart?.());
    const recover = vi.fn(async () => null);
    const postJson = vi.fn(async () => answer(200, { itinerary: jsonPlan }));
    const out = await attemptGeneration("gen-1", request(), progress(), { stream, recover, postJson });
    expect(out).toEqual({ itinerary: jsonPlan });
  });

  it("does not ask for a kept plan after a stream error, and prefers the stream's message when JSON fails too", async () => {
    const stream = streamPlaying((h) => {
      h.onStart?.();
      h.onError?.({ error: "Model overloaded" } as never);
    });
    const recover = vi.fn();
    const postJson = vi.fn(async () => answer(500, { error: "Internal error" }));
    await expect(attemptGeneration("gen-1", request(), progress(), { stream, recover, postJson })).rejects.toThrow(
      "Model overloaded"
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("goes straight to the JSON endpoint for a trip that cannot stream", async () => {
    const stream = vi.fn();
    const postJson = vi.fn(async () => answer(200, { itinerary: jsonPlan }));
    const out = await attemptGeneration("gen-1", request({ stream: false }), progress(), { stream, postJson });
    expect(out).toEqual({ itinerary: jsonPlan });
    expect(stream).not.toHaveBeenCalled();
  });

  it("reports the free-generation cap for a signed-out planner, and throws it for a signed-in one", async () => {
    const stream = vi.fn(async () => {
      throw new Error("429");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const postJson = vi.fn(async () => answer(429, { code: "RATE_LIMIT", error: "Too many" }));
    expect(await attemptGeneration("gen-1", request(), progress(), { stream, postJson })).toEqual({ capped: true });
    await expect(
      attemptGeneration("gen-1", request({ signedIn: true }), progress(), { stream, postJson })
    ).rejects.toThrow("Too many");
  });

  it("keeps a stream alive while its events keep coming, however long it runs", async () => {
    vi.useFakeTimers();
    const stream = vi.fn(
      (_body: unknown, handlers: StreamHandlers, opts?: { signal?: AbortSignal }) =>
        new Promise<void>((resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          handlers.onStart?.();
          let sent = 0;
          const tick = setInterval(() => {
            if (++sent <= 3) {
              handlers.onDay?.({ day_number: sent, date: "2027-05-10" } as SseDayData);
              return;
            }
            clearInterval(tick);
            handlers.onComplete({ itinerary: streamedPlan } as SseCompleteData);
            resolve();
          }, 600);
        })
    );
    const postJson = vi.fn();
    const pending = attemptGeneration("gen-1", request(), progress(), { stream, postJson, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(2400);
    expect(await pending).toEqual({ itinerary: streamedPlan });
    expect(postJson).not.toHaveBeenCalled();
  });

  it("gives up a stream that goes quiet, then asks the JSON endpoint", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let aborted = false;
    const stream = vi.fn(
      (_body: unknown, handlers: StreamHandlers, opts?: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          handlers.onStart?.();
          opts?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        })
    );
    const recover = vi.fn(async () => null);
    const postJson = vi.fn(async () => answer(200, { itinerary: jsonPlan }));
    const pending = attemptGeneration("gen-1", request(), progress(), { stream, recover, postJson, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ itinerary: jsonPlan });
    expect(aborted).toBe(true);
  });
});
