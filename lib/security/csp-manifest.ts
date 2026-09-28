/**
 * Inline-script hashes of every prerendered page, keyed by URL path.
 *
 * `next build` cannot know them: they come out of the HTML it writes. So
 * scripts/csp-manifest.mjs computes them once the build is done and replaces
 * the literal below inside the compiled middleware. Until that runs (dev, or
 * a bare `next build`) the manifest is empty and no page counts as static.
 *
 * Each page's value is its SHA-256 digests concatenated (44 base64 chars
 * each, no "sha256-" prefix), the densest form that survives as source text.
 */
const EMBEDDED_MANIFEST = "__MT_CSP_MANIFEST__";

interface Manifest {
  v: 2;
  pages: Record<string, string>;
}

const DIGEST_LENGTH = 44;

let pages: Map<string, readonly string[]> | undefined;

function load(): Map<string, readonly string[]> {
  if (pages) return pages;
  pages = new Map();
  try {
    const parsed = JSON.parse(EMBEDDED_MANIFEST) as Manifest;
    for (const [path, digests] of Object.entries(parsed.pages)) {
      const hashes: string[] = [];
      for (let i = 0; i + DIGEST_LENGTH <= digests.length; i += DIGEST_LENGTH) {
        hashes.push(`sha256-${digests.slice(i, i + DIGEST_LENGTH)}`);
      }
      pages.set(path, hashes);
    }
  } catch {
    // Not patched: nothing is served from the CDN, every page renders per request.
  }
  return pages;
}

/** The inline-script hashes of a prerendered page; undefined when the path renders per request. */
export function staticPageHashes(pathname: string): readonly string[] | undefined {
  return load().get(pathname);
}

export function hasStaticManifest(): boolean {
  return load().size > 0;
}
