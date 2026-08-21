import { describe, it, expect, vi } from "vitest";
import {
  filterSubmittableUrls,
  chunkUrls,
  submitToIndexNow,
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  INDEXNOW_MAX_URLS_PER_REQUEST,
} from "./indexnow";

/**
 * The failure mode worth testing here is silent: IndexNow rejects an ENTIRE
 * batch (422) if any URL is off-host, so a single stray URL loses every other
 * URL in the request. These tests pin the filtering that prevents that, plus
 * the response codes that count as success.
 */

const ok = (status = 200) =>
  vi.fn(async () => new Response("", { status })) as unknown as typeof fetch;

describe("filterSubmittableUrls", () => {
  it("drops off-host URLs instead of letting them fail the whole batch", () => {
    const { valid, skipped } = filterSubmittableUrls([
      `https://${INDEXNOW_HOST}/blog/a`,
      "https://example.com/blog/b",
    ]);
    expect(valid).toEqual([`https://${INDEXNOW_HOST}/blog/a`]);
    expect(skipped).toEqual(["https://example.com/blog/b"]);
  });

  it("drops the www host too — it 308s to the apex and is not the same host", () => {
    const { valid, skipped } = filterSubmittableUrls([
      `https://www.${INDEXNOW_HOST}/blog/a`,
    ]);
    expect(valid).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("rejects http and unparseable entries", () => {
    const { valid, skipped } = filterSubmittableUrls([
      `http://${INDEXNOW_HOST}/insecure`,
      "not a url",
    ]);
    expect(valid).toEqual([]);
    expect(skipped).toHaveLength(2);
  });

  it("de-duplicates while preserving order", () => {
    const { valid } = filterSubmittableUrls([
      `https://${INDEXNOW_HOST}/b`,
      `https://${INDEXNOW_HOST}/a`,
      `https://${INDEXNOW_HOST}/b`,
    ]);
    expect(valid).toEqual([
      `https://${INDEXNOW_HOST}/b`,
      `https://${INDEXNOW_HOST}/a`,
    ]);
  });
});

describe("chunkUrls", () => {
  it("respects the 10,000-URL protocol cap", () => {
    const urls = Array.from(
      { length: INDEXNOW_MAX_URLS_PER_REQUEST + 5 },
      (_, i) => `https://${INDEXNOW_HOST}/p/${i}`
    );
    const batches = chunkUrls(urls);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(INDEXNOW_MAX_URLS_PER_REQUEST);
    expect(batches[1]).toHaveLength(5);
  });
});

describe("submitToIndexNow", () => {
  it("sends host, key and keyLocation — all three are required by the protocol", async () => {
    const fetchImpl = ok();
    await submitToIndexNow([`https://${INDEXNOW_HOST}/x`], { fetchImpl });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.host).toBe(INDEXNOW_HOST);
    expect(body.key).toBe(INDEXNOW_KEY);
    expect(body.keyLocation).toBe(`https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`);
    expect(body.urlList).toEqual([`https://${INDEXNOW_HOST}/x`]);
  });

  it("treats 202 as success — it means accepted, key not yet validated", async () => {
    const res = await submitToIndexNow([`https://${INDEXNOW_HOST}/x`], {
      fetchImpl: ok(202),
    });
    expect(res.ok).toBe(true);
    expect(res.submitted).toBe(1);
  });

  it("reports failure without throwing, so partial success is not lost", async () => {
    const res = await submitToIndexNow([`https://${INDEXNOW_HOST}/x`], {
      fetchImpl: ok(422),
    });
    expect(res.ok).toBe(false);
    expect(res.submitted).toBe(0);
    expect(res.batches[0].status).toBe(422);
  });

  it("makes no network call when nothing is submittable", async () => {
    const fetchImpl = ok();
    const res = await submitToIndexNow(["https://example.com/a"], { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.submitted).toBe(0);
  });

  it("dryRun reports what would be sent and calls nothing", async () => {
    const fetchImpl = ok();
    const res = await submitToIndexNow(
      [`https://${INDEXNOW_HOST}/a`, `https://${INDEXNOW_HOST}/b`],
      { dryRun: true, fetchImpl }
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.submitted).toBe(2);
  });
});
