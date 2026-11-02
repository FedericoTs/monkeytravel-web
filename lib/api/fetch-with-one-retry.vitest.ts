/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithOneRetry } from "./fetch-with-one-retry";

const URL_ = "https://images.example.test/a.jpg";
const INIT = { headers: { Accept: "image/*" } };

// Each fetch takes the next step: a status to answer with, or an error to throw.
function script(...steps: (number | Error)[]) {
  const responses: Response[] = [];
  const f = vi.fn(async (_url: string, _init: RequestInit) => {
    const step = steps.shift();
    if (step === undefined) throw new Error("unexpected extra fetch");
    if (step instanceof Error) throw step;
    const res = new Response(`body ${step}`, { status: step });
    responses.push(res);
    return res;
  });
  vi.stubGlobal("fetch", f);
  return { f, responses };
}

// Runs the pause out and reports how the call settled.
async function run(): Promise<{ res?: Response; err?: Error }> {
  const settled = fetchWithOneRetry(URL_, INIT).then(
    (res) => ({ res }),
    (err: Error) => ({ err })
  );
  await vi.runAllTimersAsync();
  return settled;
}

describe("fetchWithOneRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns a success, a redirect or a 4xx from the first attempt", async () => {
    for (const status of [200, 302, 404]) {
      const { f } = script(status);
      expect((await run()).res?.status).toBe(status);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("asks again after 250 ms on a 5xx, with the same request, once the first body is drained", async () => {
    const { f, responses } = script(503, 200);
    const pending = fetchWithOneRetry(URL_, INIT);
    await vi.advanceTimersByTimeAsync(249);
    expect(f).toHaveBeenCalledTimes(1);
    expect(responses[0].bodyUsed).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1]).toEqual(f.mock.calls[0]);
  });

  it("returns the second 5xx instead of asking a third time", async () => {
    const { f } = script(500, 504);
    expect((await run()).res?.status).toBe(504);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("asks again after a network error, and throws the second one", async () => {
    const recovered = script(new TypeError("fetch failed"), 200);
    expect((await run()).res?.status).toBe(200);
    expect(recovered.f).toHaveBeenCalledTimes(2);

    const failed = script(new TypeError("first"), new TypeError("second"));
    expect((await run()).err?.message).toBe("second");
    expect(failed.f).toHaveBeenCalledTimes(2);
  });

  it("still asks again when draining the failed body fails", async () => {
    const unreadable = { status: 502, arrayBuffer: () => Promise.reject(new Error("aborted")) } as Response;
    const f = vi
      .fn()
      .mockResolvedValueOnce(unreadable)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect((await run()).res?.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
