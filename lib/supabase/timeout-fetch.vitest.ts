// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When the database stops answering, a request must fail, not hang until the
 * function's own limit: people watch a spinner for minutes, and every waiting
 * function holds its memory. The real clients run over a fetch that never answers.
 */

const s = vi.hoisted(() => ({ timeouts: [] as AbortController[], limits: [] as number[], calls: 0 }));

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const { createAdminClient } = await import("./admin");
const { createClient } = await import("./server");
const { timeoutFetch } = await import("./timeout-fetch");

/** A fetch that answers only by rejecting when its signal aborts. */
const neverAnswers = vi.fn(
  (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      s.calls++;
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })
);

const expire = () => {
  const reason = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  s.timeouts.forEach((t) => t.abort(reason));
};
/** Lets the client reach fetch, then runs out the clock. */
const expireOnceCalled = async () => {
  await vi.waitFor(() => expect(s.calls).toBeGreaterThan(0));
  expire();
};

beforeEach(() => {
  s.timeouts = [];
  s.limits = [];
  s.calls = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubGlobal("fetch", neverAnswers);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const controller = new AbortController();
    s.timeouts.push(controller);
    s.limits.push(ms);
    return controller.signal;
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("timeoutFetch", () => {
  it("waits 30 seconds, far past any healthy call and far short of a function's limit", async () => {
    const call = timeoutFetch("https://db.example.com/rest/v1/trips");
    expect(s.limits).toEqual([30_000]);
    expire();
    await expect(call).rejects.toMatchObject({ name: "AbortError", message: expect.stringContaining("No answer") });
  });

  it("reports any other failure as it came", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(timeoutFetch("https://db.example.com/x")).rejects.toMatchObject({ name: "TypeError", message: "fetch failed" });
  });

  it("answers what the server answers", async () => {
    const answer = new Response("ok");
    vi.stubGlobal("fetch", vi.fn(async () => answer));
    await expect(timeoutFetch("https://db.example.com/x")).resolves.toBe(answer);
  });

  it("passes the request on as it came", async () => {
    const answers = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response("ok"));
    vi.stubGlobal("fetch", answers);
    await timeoutFetch("https://db.example.com/x", { method: "POST", body: "{}" });
    expect(answers.mock.calls[0][0]).toBe("https://db.example.com/x");
    expect(answers.mock.calls[0][1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("still stops when the caller's own signal does", async () => {
    const own = new AbortController();
    const call = timeoutFetch("https://db.example.com/x", { signal: own.signal });
    own.abort(new DOMException("Stopped", "AbortError"));
    await expect(call).rejects.toMatchObject({ name: "AbortError" });
  });

  it("still stops at the limit when the caller has a signal of its own", async () => {
    const call = timeoutFetch("https://db.example.com/x", { signal: new AbortController().signal });
    expire();
    await expect(call).rejects.toMatchObject({ name: "AbortError", message: expect.stringContaining("No answer") });
  });
});

describe("the clients a request uses", () => {
  it("the service-role client answers a hung database with an error, without trying again", async () => {
    // A query starts when awaited.
    const read = Promise.resolve(createAdminClient().from("trips").select("id"));
    await expireOnceCalled();
    const { data, error } = await read;
    expect(data).toBeNull();
    expect(error?.message).toContain("No answer");
    expect(s.calls).toBe(1);
  });

  it("the signed-in client answers a hung database with an error, without trying again", async () => {
    const client = await createClient();
    const read = Promise.resolve(client.from("trips").select("id"));
    await expireOnceCalled();
    const { data, error } = await read;
    expect(data).toBeNull();
    expect(error?.message).toContain("No answer");
    expect(s.calls).toBe(1);
  });
});
