/**
 * IndexNow submission.
 *
 * WHY THIS EXISTS
 *
 * IndexNow is a push protocol: instead of waiting for a crawler to notice a
 * changed page, you tell the participating engines directly. Bing, Yandex,
 * Seznam and Naver share one endpoint, so a single POST reaches all of them.
 *
 * The reason it earns its place here is not Bing's own search share — it is
 * that ChatGPT's search grounding reads Bing's index, and ChatGPT is the
 * overwhelming majority of AI referral traffic. Getting a page into that index
 * sooner is the cheapest AI-visibility lever available to us. Google does not
 * participate; it keeps using the sitemap.
 *
 * Deliberately NOT wired into publishing. Submission is an explicit action
 * (scripts/indexnow-submit.mts) so the content pipeline is untouched.
 *
 * Protocol notes that the implementation below depends on:
 *  - The key must be retrievable at https://<host>/<key>.txt and the file body
 *    must be exactly the key. See public/d234d1f43ba566ffbaab784eca56c66a.txt.
 *  - Every submitted URL must be on the same host as `host`. Mixing hosts gets
 *    the whole batch rejected (422), not just the offending URL.
 *  - Max 10,000 URLs per request.
 *  - 200 = accepted, 202 = accepted but key not yet validated. Both are fine.
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_HOST = "monkeytravel.app";
export const INDEXNOW_KEY = "d234d1f43ba566ffbaab784eca56c66a";
export const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`;

/** Protocol cap: a single submission may carry at most 10,000 URLs. */
export const INDEXNOW_MAX_URLS_PER_REQUEST = 10_000;

export interface IndexNowBatchResult {
  ok: boolean;
  status: number;
  count: number;
  body?: string;
}

export interface IndexNowResult {
  submitted: number;
  skipped: string[];
  batches: IndexNowBatchResult[];
  ok: boolean;
}

/**
 * Keep only https URLs on INDEXNOW_HOST, de-duplicated and order-stable.
 *
 * Off-host URLs are dropped rather than passed through: one foreign host
 * fails the entire batch, so silently submitting them would turn a partial
 * mistake into a total one.
 */
export function filterSubmittableUrls(urls: readonly string[]): {
  valid: string[];
  skipped: string[];
} {
  const valid: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const url = raw.trim();
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      skipped.push(url);
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== INDEXNOW_HOST) {
      skipped.push(url);
      continue;
    }
    const normalised = parsed.toString();
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    valid.push(normalised);
  }

  return { valid, skipped };
}

/** Split into protocol-legal request batches. */
export function chunkUrls(
  urls: readonly string[],
  size: number = INDEXNOW_MAX_URLS_PER_REQUEST
): string[][] {
  if (size < 1) throw new Error("chunkUrls: size must be >= 1");
  const out: string[][] = [];
  for (let i = 0; i < urls.length; i += size) {
    out.push(urls.slice(i, i + size));
  }
  return out;
}

/**
 * Submit URLs to IndexNow. Returns a report rather than throwing, so a caller
 * can log a partial failure without losing the successful batches.
 */
export async function submitToIndexNow(
  urls: readonly string[],
  opts: { dryRun?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<IndexNowResult> {
  const { valid, skipped } = filterSubmittableUrls(urls);
  const batches: IndexNowBatchResult[] = [];

  if (valid.length === 0) {
    return { submitted: 0, skipped, batches, ok: true };
  }

  if (opts.dryRun) {
    return {
      submitted: valid.length,
      skipped,
      batches: chunkUrls(valid).map((b) => ({
        ok: true,
        status: 0,
        count: b.length,
      })),
      ok: true,
    };
  }

  const doFetch = opts.fetchImpl ?? fetch;

  for (const batch of chunkUrls(valid)) {
    const res = await doFetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: INDEXNOW_KEY_LOCATION,
        urlList: batch,
      }),
    });

    // 200 accepted; 202 accepted pending key validation. Anything else failed.
    const ok = res.status === 200 || res.status === 202;
    batches.push({
      ok,
      status: res.status,
      count: batch.length,
      body: ok ? undefined : await res.text().catch(() => undefined),
    });
  }

  return {
    submitted: batches.filter((b) => b.ok).reduce((n, b) => n + b.count, 0),
    skipped,
    batches,
    ok: batches.every((b) => b.ok),
  };
}
