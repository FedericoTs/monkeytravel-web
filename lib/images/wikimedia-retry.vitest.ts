/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wiki } from "./wikimedia";

/**
 * Wikimedia turns a request away for now (429) when it has had too many from
 * this address, which a serverless platform shares between many sites. The
 * request is made once more after the wait it names, up to two seconds; then
 * the 429 is the answer, as any other error is at once.
 */

const API = "https://www.wikidata.org/w/api.php";
const busy = (retryAfter?: string) => ({ ok: false, status: 429, headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}), json: async () => ({}) });
const fine = { ok: true, status: 200, headers: new Headers(), json: async () => ({ answer: 1 }) };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.useRealTimers());

describe("a request Wikimedia turns away for now", () => {
  it("is made once more after the wait it names", async () => {
    fetchMock.mockResolvedValueOnce(busy("1")).mockResolvedValueOnce(fine);
    const answer = wiki(API, { action: "query" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ answer: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits two seconds at most, and a second when it names no wait", async () => {
    fetchMock.mockResolvedValueOnce(busy("30")).mockResolvedValueOnce(fine);
    const long = wiki(API, {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await long).toEqual({ answer: 1 });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(busy()).mockResolvedValueOnce(fine);
    const none = wiki(API, {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await none).toEqual({ answer: 1 });
  });

  it("answers with the second 429", async () => {
    fetchMock.mockResolvedValue(busy("1"));
    const answer = wiki(API, {}, new AbortController().signal);
    const failed = expect(answer).rejects.toThrow("www.wikidata.org answered 429");
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is not made again after any other error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, headers: new Headers(), json: async () => ({}) });
    await expect(wiki(API, {}, new AbortController().signal)).rejects.toThrow("www.wikidata.org answered 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when the lookup is called off", async () => {
    fetchMock.mockResolvedValueOnce(busy("1")).mockResolvedValueOnce(fine);
    const controller = new AbortController();
    const answer = wiki(API, {}, controller.signal);
    const stopped = expect(answer).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await stopped;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
