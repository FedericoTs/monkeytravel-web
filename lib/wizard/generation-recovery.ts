import { newGenerationId } from "@/lib/ai/generation-id";
import { classifyGenerationFailure } from "@/lib/wizard/generation-failure";

/**
 * A plan the server finished but the browser never received. A phone that
 * leaves the page while it waits drops the request and, back on the page, gets
 * "Load failed" although the plan is done. So when a generation's answer is
 * lost, the plan is first collected under that request's generation id
 * (GET /api/ai/generate/result). Only if nothing was kept is the generation
 * tried once more, and that try is recovered the same way. Client-safe.
 */

/** Longer than any generation takes: past it, the answer is taken as lost. */
export const GENERATION_TIMEOUT_MS = 90_000;

export type LostGenerationError = Error & { generationId?: string };

/** The answer never arrived: the connection dropped, or the wait ran out. */
export function isLostResponse(err: unknown): boolean {
  const code = classifyGenerationFailure(err);
  return code === "network" || code === "timeout";
}

/** The plan kept under this id, asking again while the server may still be finishing. */
export async function recoverGeneration<T extends { itinerary?: unknown }>(
  id: string,
  { attempts = 3, delayMs = 3000, fetchImpl = fetch }: { attempts?: number; delayMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const res = await fetchImpl(`/api/ai/generate/result?id=${encodeURIComponent(id)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as T;
        if (data?.itinerary) return data;
      } else if (res.status !== 404) {
        return null;
      }
    } catch {
      // Still offline: ask again.
    }
  }
  return null;
}

/** POSTs a JSON body and reads the JSON answer, giving up after `timeoutMs`. */
export async function postJsonWithTimeout<T>(
  url: string,
  body: unknown,
  { headers = {}, timeoutMs, fetchImpl = fetch }: { headers?: Record<string, string>; timeoutMs: number; fetchImpl?: typeof fetch }
): Promise<{ response: Response; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { response, data: (await response.json()) as T };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One generation, with the fallback above. `attempt` runs one try under the
 * generation id it is given. An error that is not a lost answer is thrown at
 * once; the error finally thrown carries the last try's generation id.
 */
export async function generateWithRecovery<T extends { itinerary?: unknown }>(
  attempt: (generationId: string) => Promise<T>,
  {
    recover = (id: string) => recoverGeneration<T>(id),
    newId = newGenerationId,
  }: { recover?: (id: string) => Promise<T | null>; newId?: () => string } = {}
): Promise<{ result: T; generationId: string; recovered: boolean }> {
  let lost: LostGenerationError | null = null;
  for (let round = 0; round < 2; round++) {
    const generationId = newId();
    try {
      return { result: await attempt(generationId), generationId, recovered: false };
    } catch (err) {
      const tagged = withGenerationId(err, generationId);
      if (!isLostResponse(err)) throw tagged;
      const kept = await recover(generationId);
      if (kept) return { result: kept, generationId, recovered: true };
      lost = tagged;
    }
  }
  throw lost;
}

function withGenerationId(err: unknown, generationId: string): LostGenerationError {
  const error: LostGenerationError = err instanceof Error ? err : new Error(String(err));
  try {
    error.generationId = generationId;
  } catch {
    // A frozen error: logged without its id.
  }
  return error;
}
