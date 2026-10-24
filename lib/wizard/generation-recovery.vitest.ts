/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERATION_TIMEOUT_MS,
  generateWithRecovery,
  isLostResponse,
  postJsonWithTimeout,
  recoverGeneration,
} from "./generation-recovery";

/**
 * A plan the server finished is collected by its generation id when the
 * answer never reached the browser, and only then is the generation run once
 * more: never a second paid generation while a finished one is kept.
 */

const plan = { itinerary: { days: [{ day_number: 1 }] } };
const lost = () => new TypeError("Load failed");
const ids = (...list: string[]) => {
  let next = 0;
  return () => list[next++];
};

describe("generateWithRecovery", () => {
  it("returns the first try's plan without asking for a kept one", async () => {
    const recover = vi.fn();
    const out = await generateWithRecovery(async () => plan, { recover, newId: ids("a") });
    expect(out).toEqual({ result: plan, generationId: "a", recovered: false });
    expect(recover).not.toHaveBeenCalled();
  });

  it("collects the plan of a try whose answer was lost, instead of generating again", async () => {
    const attempt = vi.fn<(id: string) => Promise<typeof plan>>(async () => {
      throw lost();
    });
    const recover = vi.fn(async (id: string) => (id === "a" ? plan : null));
    const out = await generateWithRecovery(attempt, { recover, newId: ids("a", "b") });
    expect(out).toEqual({ result: plan, generationId: "a", recovered: true });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("generates once more when nothing was kept", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValueOnce(plan);
    const recover = vi.fn<(id: string) => Promise<typeof plan | null>>(async () => null);
    const out = await generateWithRecovery(attempt, { recover, newId: ids("a", "b") });
    expect(out).toEqual({ result: plan, generationId: "b", recovered: false });
    expect(attempt.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  });

  it("collects the second try's plan the same way", async () => {
    const attempt = vi.fn<(id: string) => Promise<typeof plan>>(async () => {
      throw lost();
    });
    const recover = vi.fn(async (id: string) => (id === "b" ? plan : null));
    const out = await generateWithRecovery(attempt, { recover, newId: ids("a", "b") });
    expect(out).toEqual({ result: plan, generationId: "b", recovered: true });
  });

  it("gives up after the second lost try, naming that try's generation", async () => {
    const attempt = vi.fn<(id: string) => Promise<typeof plan>>(async () => {
      throw lost();
    });
    const recover = vi.fn<(id: string) => Promise<typeof plan | null>>(async () => null);
    await expect(generateWithRecovery(attempt, { recover, newId: ids("a", "b") })).rejects.toMatchObject({
      message: "Load failed",
      generationId: "b",
    });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(recover.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  });

  it("throws any other failure at once, without recovering or trying again", async () => {
    const attempt = vi.fn<(id: string) => Promise<typeof plan>>(async () => {
      throw new Error("Trip is too long");
    });
    const recover = vi.fn();
    await expect(generateWithRecovery(attempt, { recover, newId: ids("a", "b") })).rejects.toMatchObject({
      message: "Trip is too long",
      generationId: "a",
    });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
  });
});

describe("isLostResponse", () => {
  it("is a dropped connection or a wait that ran out", () => {
    expect(isLostResponse(new TypeError("Load failed"))).toBe(true);
    expect(isLostResponse(new TypeError("Failed to fetch"))).toBe(true);
    expect(isLostResponse(new DOMException("signal is aborted without reason", "AbortError"))).toBe(true);
    expect(isLostResponse(new Error("Generation failed. Please try again."))).toBe(false);
    expect(isLostResponse(new Error("Trip is too long"))).toBe(false);
  });
});

describe("recoverGeneration", () => {
  const found = () => new Response(JSON.stringify({ success: true, ...plan, recovered: true }), { status: 200 });
  const notYet = () => new Response(JSON.stringify({ error: "No plan kept" }), { status: 404 });

  it("asks again while nothing is kept yet", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(notYet()).mockResolvedValueOnce(found());
    expect(await recoverGeneration("abc", { delayMs: 0, fetchImpl })).toMatchObject(plan);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/ai/generate/result?id=abc");
  });

  it("is null when nothing was ever kept", async () => {
    const fetchImpl = vi.fn(async () => notYet());
    expect(await recoverGeneration("abc", { attempts: 3, delayMs: 0, fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops at a refusal", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    expect(await recoverGeneration("abc", { delayMs: 0, fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rides out a connection that is still down", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValueOnce(found());
    expect(await recoverGeneration("abc", { delayMs: 0, fetchImpl })).toMatchObject(plan);
  });
});

describe("postJsonWithTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("sends the body and the given headers, and reads the answer", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(plan), { status: 200 }));
    const { response, data } = await postJsonWithTimeout("/api/ai/generate", { destination: "Rome" }, {
      headers: { "x-generation-id": "abc" },
      timeoutMs: GENERATION_TIMEOUT_MS,
      fetchImpl,
    });
    expect(response.ok).toBe(true);
    expect(data).toEqual(plan);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/generate");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", "x-generation-id": "abc" });
    expect(JSON.parse(String(init.body))).toEqual({ destination: "Rome" });
  });

  it("gives up after the timeout, as a lost answer", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new DOMException("signal is aborted without reason", "AbortError")))
        )
    );
    const pending = postJsonWithTimeout("/api/ai/generate", {}, { timeoutMs: GENERATION_TIMEOUT_MS, fetchImpl: fetchImpl as typeof fetch });
    const outcome = pending.then(
      () => "answered",
      (err: unknown) => (isLostResponse(err) ? "lost" : "other")
    );
    await vi.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS - 1);
    expect(fetchImpl.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("lost");
  });
});
