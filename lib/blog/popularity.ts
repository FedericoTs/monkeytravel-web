/**
 * Rank blog posts by popularity (PostHog `$pageview` counts), so the
 * marketing digest can be a genuine "top posts" newsletter rather than just
 * newest-first.
 *
 * Server-only. Requires:
 *   POSTHOG_PERSONAL_API_KEY  (phx_…)  — a Personal API key with query scope
 *                                        (NOT the phc_ project/ingestion key)
 *   POSTHOG_PROJECT_ID                  — numeric project id
 *   NEXT_PUBLIC_POSTHOG_HOST (optional) — ingestion host; query host derived
 *   POSTHOG_QUERY_HOST       (optional) — override the query host outright
 *
 * Degrades gracefully: returns [] when unconfigured or on any error, so
 * callers fall back to chronological order. Never throws.
 */

interface RankOpts {
  /** Look-back window in days. Default 90. */
  days?: number;
  /** Max slugs to return. Default 50. */
  limit?: number;
}

/**
 * Query host differs from the ingestion host: events are sent to
 * `us.i.posthog.com` but the query API lives at `us.posthog.com`.
 */
function resolveQueryHost(): string {
  if (process.env.POSTHOG_QUERY_HOST) return process.env.POSTHOG_QUERY_HOST;
  const ingest = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com";
  // us.i.posthog.com → us.posthog.com ; eu.i.posthog.com → eu.posthog.com
  return ingest.replace(".i.posthog.com", ".posthog.com");
}

/** Extract a blog slug from a pathname like `/es/blog/3-day-paris?x=1`. */
function slugFromPath(path: string): string | null {
  const m = path.match(/\/blog\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Returns blog slugs ordered by total pageviews (desc) over the window.
 * Aggregates across locales (/blog/x, /es/blog/x → same slug). [] on failure.
 */
export async function getTopBlogSlugs(opts: RankOpts = {}): Promise<string[]> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return [];

  const days = opts.days ?? 90;
  const limit = opts.limit ?? 50;
  const host = resolveQueryHost();

  // HogQL: count $pageview by pathname for blog URLs in the window.
  const query = `
    SELECT properties.$pathname AS path, count() AS views
    FROM events
    WHERE event = '$pageview'
      AND properties.$pathname LIKE '%/blog/%'
      AND timestamp > now() - INTERVAL ${days} DAY
    GROUP BY path
    ORDER BY views DESC
    LIMIT 500
  `.trim();

  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
    if (!res.ok) {
      console.warn(
        `[blog/popularity] PostHog query failed (${res.status}); falling back to recent`
      );
      return [];
    }
    const json = (await res.json()) as { results?: Array<[string, number]> };
    const rows = json.results ?? [];

    // Aggregate views per slug across locale variants.
    const bySlug = new Map<string, number>();
    for (const [path, views] of rows) {
      const slug = slugFromPath(path);
      if (!slug) continue;
      bySlug.set(slug, (bySlug.get(slug) ?? 0) + (Number(views) || 0));
    }

    return [...bySlug.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([slug]) => slug);
  } catch (err) {
    console.warn(
      "[blog/popularity] PostHog query errored; falling back to recent:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
