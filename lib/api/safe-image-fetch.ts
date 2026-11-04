/**
 * Fetch a user-supplied image URL with the host allowlist enforced on EVERY
 * redirect hop, not just the initial URL.
 *
 * THE GAP THIS CLOSES
 * A proxy that validates the URL it is handed and then fetches with
 * redirect:"follow" guards hop zero only: an allowlisted host that answers 302
 * could send us anywhere — off-allowlist, or at an internal address — and we
 * would stream the bytes back to the client.
 *
 * WHY IT DOES NOT BREAK LEGITIMATE IMAGES
 * Redirects to hosts that ARE allowlisted still follow normally — only
 * off-allowlist and internal targets are refused. Measured against the real
 * traffic before writing this: images.pexels.com (4,274 of the stored image
 * URLs) and images.unsplash.com both answer 200 with no redirect at all, and
 * lib/img/proxyUrl.ts only ever routes those two hosts through the proxy.
 */

export interface SafeImageFetchInit extends Omit<RequestInit, "redirect"> {
  /** The hostnames a hop may reach, matched exactly. */
  allowedHosts: ReadonlySet<string>;
  /** Hops to follow before giving up. 3 is well clear of real CDN chains. */
  maxHops?: number;
  /**
   * Fetch to use per hop. The img proxies pass fetchWithOneRetry so a 5xx
   * still gets its retry; a 3xx is never retried, so redirects are unaffected.
   */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export type SafeImageFetchResult =
  | { ok: true; response: Response; finalUrl: string; hops: number }
  | { ok: false; status: number; reason: string };

/** Statuses that carry a Location we would otherwise have followed blindly. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Addresses that must never be fetched on a user's behalf: `localhost` names,
 * the loopback, private and link-local IPv4 ranges, and the IPv6 loopback and
 * unspecified addresses. No public image host resolves to any of them.
 *
 * This is a hostname check, not a resolved-IP check: a DNS name pointing at a
 * private address still passes. That is a known limit, accepted here because
 * on Vercel there is no cloud-metadata endpoint or internal network to reach,
 * and every hop must additionally be on the caller's allowlist.
 */
export function isInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    h.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "::1" ||
    h === "[::]" ||
    h === "::"
  );
}

/** Returns a human-readable reason the hop is refused, or null if it is fine. */
function rejectionReason(u: URL, allowedHosts: ReadonlySet<string>): string | null {
  if (u.protocol !== "https:") return `non-https (${u.protocol.replace(":", "")})`;
  if (isInternalHostname(u.hostname)) return `internal address (${u.hostname})`;
  if (!allowedHosts.has(u.hostname)) return `host not allowed (${u.hostname})`;
  return null;
}

/** Release a redirect response so undici does not hold the socket open. */
async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* already consumed or no body — nothing to release */
  }
}

/**
 * Fetch `initialUrl`, re-validating the allowlist and internal-address rules
 * against every redirect target before following it.
 *
 * Returns a discriminated result rather than throwing, so the caller can map a
 * refusal onto its own error shape without a try/catch.
 *
 * Note it does NOT enforce size or content-type: the caller does, with its own
 * error codes.
 */
export async function safeImageFetch(
  initialUrl: string,
  opts: SafeImageFetchInit
): Promise<SafeImageFetchResult> {
  const { allowedHosts, maxHops = 3, fetchImpl, ...init } = opts;
  const doFetch = fetchImpl ?? ((u: string, i: RequestInit) => fetch(u, i));

  let current: URL;
  try {
    current = new URL(initialUrl);
  } catch {
    return { ok: false, status: 400, reason: "malformed url" };
  }

  const initialRejection = rejectionReason(current, allowedHosts);
  if (initialRejection) {
    return { ok: false, status: 403, reason: initialRejection };
  }

  for (let hop = 0; hop <= maxHops; hop++) {
    let res: Response;
    try {
      // "manual" is what makes this work: on the server (undici) it hands back
      // the real 3xx with a readable Location instead of transparently
      // following it, which is the whole point.
      res = await doFetch(current.toString(), { ...init, redirect: "manual" });
    } catch {
      return { ok: false, status: 502, reason: "upstream fetch failed" };
    }

    if (!REDIRECT_STATUSES.has(res.status)) {
      return { ok: true, response: res, finalUrl: current.toString(), hops: hop };
    }

    const location = res.headers.get("location");
    await discardBody(res);
    if (!location) {
      return { ok: false, status: 502, reason: `${res.status} with no Location` };
    }

    let next: URL;
    try {
      // Resolved against the CURRENT url, so relative Location headers work.
      next = new URL(location, current);
    } catch {
      return { ok: false, status: 502, reason: "unparseable Location" };
    }

    const rejection = rejectionReason(next, allowedHosts);
    if (rejection) {
      return { ok: false, status: 403, reason: `blocked redirect to ${rejection}` };
    }
    current = next;
  }

  return { ok: false, status: 502, reason: `more than ${maxHops} redirects` };
}

/** Upper bound on a proxied image. Real covers are well under 1 MB, so this is generous. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Reject a body the upstream did not label as an image.
 *
 * The `|| "image/jpeg"` fallback is deliberate: some CDNs omit the header on
 * perfectly valid images, and hard requiring it would break them. What this
 * does stop is a response that positively declares itself something else — an
 * HTML error page or a JSON blob — being served as though it were a photo.
 */
export function imageContentType(response: Response): string | null {
  const ct = response.headers.get("content-type") || "image/jpeg";
  return ct.startsWith("image/") ? ct : null;
}
