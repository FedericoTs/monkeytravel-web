import { describe, expect, it } from "vitest";
import { freshness } from "./freshness";

/**
 * A read that overlapped one of the screen's own changes may predate it, so it
 * is dropped; of two reads, the one started last wins.
 */

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("freshness", () => {
  it("shows a read that no change overlapped", () => {
    const fresh = freshness();
    expect(fresh.startRead()()).toBe(true);
  });

  it("drops a read that started before one of the screen's own changes", async () => {
    const fresh = freshness();
    const current = fresh.startRead();
    await fresh.write(async () => undefined);
    expect(current()).toBe(false);
  });

  it("drops a read that started while a change was being saved", async () => {
    const fresh = freshness();
    const saving = deferred();
    const write = fresh.write(() => saving.promise);
    const current = fresh.startRead();
    saving.resolve();
    await write;
    expect(current()).toBe(false);
  });

  it("shows a read that started after the change was saved", async () => {
    const fresh = freshness();
    await fresh.write(async () => undefined);
    expect(fresh.startRead()()).toBe(true);
  });

  it("lets the read started last win", () => {
    const fresh = freshness();
    const first = fresh.startRead();
    const second = fresh.startRead();
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });

  it("still releases the change when saving fails", async () => {
    const fresh = freshness();
    await expect(fresh.write(async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    expect(fresh.startRead()()).toBe(true);
  });
});
