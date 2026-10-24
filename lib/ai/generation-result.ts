import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { GENERATION_ID_HEADER, isGenerationId } from "@/lib/ai/generation-id";

/**
 * A finished plan, kept for a while under the generation id its request carried
 * (lib/ai/generation-id.ts). A phone that leaves the page while it waits drops
 * the request, and the server's answer with it; back on the page, the wizard
 * collects the plan from GET /api/ai/generate/result instead of paying for
 * another generation.
 *
 * Kept in Upstash when it is configured, else in this instance's memory (local
 * dev, tests). Bound to the browser's mt_session_id when it has one.
 */

const TTL_SECONDS = 30 * 60;
// Upstash refuses requests over 1 MB.
const MAX_BYTES = 900_000;
// The answer waits for the plan to be kept, but never long: the client retries
// a slow Upstash, and a plan not kept can only not be recovered.
const KEEP_WAIT_MS = 1500;

export interface KeptGeneration {
  itinerary: unknown;
  meta?: unknown;
}

interface Kept {
  owner: string | null;
  result: KeptGeneration;
}

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
// On globalThis: in dev, two routes can load their own copy of this module.
const memory = ((globalThis as { __keptGenerations?: Map<string, { kept: Kept; expiresAt: number }> }).__keptGenerations ??=
  new Map());

const keyOf = (id: string) => `generation:${id.toLowerCase()}`;

/** The generation id a request carries, or null. */
export function generationIdOf(request: Request): string | null {
  const id = request.headers.get(GENERATION_ID_HEADER);
  return isGenerationId(id) ? id.toLowerCase() : null;
}

/** Whose plan it is: the browser's session cookie, when it has one. */
export function generationOwner(request: NextRequest): string | null {
  return request.cookies.get("mt_session_id")?.value || null;
}

/** Keeps a finished plan under its id. Never throws: a plan not kept only can't be recovered. */
export async function keepGeneration(id: string, owner: string | null, result: KeptGeneration): Promise<void> {
  const kept: Kept = { owner, result };
  try {
    const json = JSON.stringify(kept);
    if (json.length > MAX_BYTES) return;
    if (redis) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        redis.set(keyOf(id), json, { ex: TTL_SECONDS }),
        new Promise((resolve) => (timer = setTimeout(resolve, KEEP_WAIT_MS))),
      ]).finally(() => clearTimeout(timer));
      return;
    }
    const now = Date.now();
    if (memory.size > 200) {
      for (const [key, entry] of memory) if (entry.expiresAt <= now) memory.delete(key);
    }
    memory.set(keyOf(id), { kept, expiresAt: now + TTL_SECONDS * 1000 });
  } catch (err) {
    console.warn("[generation-result] keep failed:", err);
  }
}

/** The plan kept under this id for this browser, or null. */
export async function findGeneration(id: string, owner: string | null): Promise<KeptGeneration | null> {
  let kept: Kept | null = null;
  try {
    if (redis) {
      const raw = await redis.get<Kept | string>(keyOf(id));
      kept = typeof raw === "string" ? (JSON.parse(raw) as Kept) : raw ?? null;
    } else {
      const entry = memory.get(keyOf(id));
      kept = entry && entry.expiresAt > Date.now() ? entry.kept : null;
    }
  } catch (err) {
    console.warn("[generation-result] find failed:", err);
    return null;
  }
  if (!kept?.result?.itinerary || (kept.owner && kept.owner !== owner)) return null;
  return kept.result;
}
