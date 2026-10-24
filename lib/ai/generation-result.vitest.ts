/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GENERATION_ID_HEADER, isGenerationId, newGenerationId } from "./generation-id";

/**
 * A finished plan is kept under its generation id for the browser that asked
 * for it, for a while. No Upstash in tests: this instance's memory keeps it.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
const { findGeneration, generationIdOf, generationOwner, keepGeneration } = await import("./generation-result");

const plan = { itinerary: { days: [{ day_number: 1 }] }, meta: { cached: false } };

describe("generation ids", () => {
  it("are random v4 ids", () => {
    const id = newGenerationId();
    expect(isGenerationId(id)).toBe(true);
    expect(id[14]).toBe("4");
    expect(newGenerationId()).not.toBe(id);
  });

  it("are read from the request only when well formed", () => {
    const id = newGenerationId();
    const withHeader = (value: string) => new Request("https://monkeytravel.app/api/ai/generate", { headers: { [GENERATION_ID_HEADER]: value } });
    expect(generationIdOf(withHeader(id.toUpperCase()))).toBe(id);
    expect(generationIdOf(withHeader("generation:../other"))).toBeNull();
    expect(generationIdOf(new Request("https://monkeytravel.app/api/ai/generate"))).toBeNull();
  });

  it("belong to the browser's session cookie", () => {
    const withCookie = new NextRequest("https://monkeytravel.app/api/ai/generate", { headers: { cookie: "mt_session_id=s1" } });
    expect(generationOwner(withCookie)).toBe("s1");
    expect(generationOwner(new NextRequest("https://monkeytravel.app/api/ai/generate"))).toBeNull();
  });
});

describe("kept generations", () => {
  afterEach(() => vi.useRealTimers());

  it("are found under their id by the browser that asked", async () => {
    const id = newGenerationId();
    await keepGeneration(id, "s1", plan);
    expect(await findGeneration(id, "s1")).toEqual(plan);
  });

  it("are not handed to another browser", async () => {
    const id = newGenerationId();
    await keepGeneration(id, "s1", plan);
    expect(await findGeneration(id, "s2")).toBeNull();
    expect(await findGeneration(id, null)).toBeNull();
  });

  it("are found by id alone when the request had no session", async () => {
    const id = newGenerationId();
    await keepGeneration(id, null, plan);
    expect(await findGeneration(id, "s1")).toEqual(plan);
  });

  it("expire", async () => {
    vi.useFakeTimers();
    const id = newGenerationId();
    await keepGeneration(id, "s1", plan);
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(await findGeneration(id, "s1")).toEqual(plan);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(await findGeneration(id, "s1")).toBeNull();
  });

  it("are nothing for an id never kept", async () => {
    expect(await findGeneration(newGenerationId(), "s1")).toBeNull();
  });
});
