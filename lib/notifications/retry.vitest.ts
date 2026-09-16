/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { isTransientMessage, retryTransient } from "./retry";

const noSleep = async () => {};

function script<T extends { error: { message: string } | null }>(results: T[]) {
  let i = 0;
  const calls: number[] = [];
  const query = async () => {
    calls.push(i);
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return r;
  };
  return { query, calls };
}

describe("isTransientMessage", () => {
  it("matches the gateway and statement timeouts the cron has actually seen", () => {
    expect(isTransientMessage("Gateway Timeout")).toBe(true);
    expect(isTransientMessage("canceling statement due to statement timeout")).toBe(true);
    expect(isTransientMessage("TypeError: fetch failed")).toBe(true);
  });

  it("leaves real errors alone", () => {
    expect(isTransientMessage("new row violates row-level security policy")).toBe(false);
    expect(isTransientMessage("")).toBe(false);
    expect(isTransientMessage(null)).toBe(false);
  });
});

describe("retryTransient", () => {
  it("returns the first result when it succeeds, with a single call", async () => {
    const { query, calls } = script([{ error: null, data: [1] }]);
    const r = await retryTransient(query, { sleep: noSleep });
    expect(r.data).toEqual([1]);
    expect(calls).toHaveLength(1);
  });

  it("retries a Gateway Timeout and returns the later success", async () => {
    const retries: string[] = [];
    const { query, calls } = script([
      { error: { message: "Gateway Timeout" }, data: null },
      { error: { message: "Gateway Timeout" }, data: null },
      { error: null, data: [7] },
    ]);
    const r = await retryTransient(query, {
      sleep: noSleep,
      onRetry: (n, m) => retries.push(`${n}:${m}`),
    });
    expect(r.error).toBeNull();
    expect(r.data).toEqual([7]);
    expect(calls).toHaveLength(3);
    expect(retries).toEqual(["1:Gateway Timeout", "2:Gateway Timeout"]);
  });

  it("gives up after the configured attempts and returns the last error", async () => {
    const { query, calls } = script([{ error: { message: "Gateway Timeout" }, data: null }]);
    const r = await retryTransient(query, { attempts: 3, sleep: noSleep });
    expect(r.error?.message).toBe("Gateway Timeout");
    expect(calls).toHaveLength(3);
  });

  it("does not retry a non-transient error", async () => {
    const { query, calls } = script([{ error: { message: "permission denied" }, data: null }]);
    const r = await retryTransient(query, { sleep: noSleep });
    expect(r.error?.message).toBe("permission denied");
    expect(calls).toHaveLength(1);
  });

  it("waits the configured delays between attempts, repeating the last one", async () => {
    const waited: number[] = [];
    const { query } = script([
      { error: { message: "timed out" }, data: null },
      { error: { message: "timed out" }, data: null },
      { error: { message: "timed out" }, data: null },
      { error: null, data: [] },
    ]);
    await retryTransient(query, {
      attempts: 4,
      delaysMs: [100, 250],
      sleep: async (ms) => {
        waited.push(ms);
      },
    });
    expect(waited).toEqual([100, 250, 250]);
  });
});
