import type { NextRequest } from "next/server";
import { sha256Source } from "./csp";

/**
 * Inline-script hashes of a prerendered page, taken from the HTML the CDN
 * actually serves.
 *
 * A prerendered page cannot carry a per-request nonce, so its CSP pins each
 * inline script by hash. The hashes cannot come from the build: Vercel's
 * builder captures the middleware while `next build` runs, before any
 * post-build step could embed them. So the first request for a path in an
 * isolate fetches the page from this same deployment (a CDN hit, marked with
 * PROBE_HEADER so middleware serves it bare), hashes its inline scripts and
 * remembers them. Later requests for the path cost nothing.
 */
export const PROBE_HEADER = "x-mt-csp-probe";

const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
const MAX_CACHED_PATHS = 2000;

/** `sha256-…` of every inline script the browser would execute. */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  const bodies = new Set<string>();
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = script.exec(html))) {
    const [, attrs, body] = match;
    if (/\ssrc\s*=/i.test(attrs) || !body) continue;
    const type = (attrs.match(/\stype\s*=\s*["']?([^"'\s>]*)/i)?.[1] ?? "").toLowerCase();
    if (!JS_TYPES.has(type)) continue; // JSON-LD and other data blocks never execute
    bodies.add(body);
  }
  const hashes = await Promise.all([...bodies].map(sha256Source));
  return hashes.sort();
}

/** What the probe learned about a path: its hashes, or null when it is rendered per request. */
type Verdict = readonly string[] | null;

const verdicts = new Map<string, Verdict>();
const inFlight = new Map<string, Promise<Verdict>>();

function remember(pathname: string, verdict: Verdict): Verdict {
  if (verdicts.size >= MAX_CACHED_PATHS) {
    const oldest = verdicts.keys().next().value;
    if (oldest !== undefined) verdicts.delete(oldest);
  }
  verdicts.set(pathname, verdict);
  return verdict;
}

async function probe(request: NextRequest): Promise<Verdict> {
  const { pathname, origin } = request.nextUrl;
  const headers: Record<string, string> = { [PROBE_HEADER]: "1", "user-agent": "MonkeyTravel-csp-probe/1.0" };
  // A protected preview only answers with the visitor's own Vercel cookie.
  const vercelCookies = request.cookies
    .getAll()
    .filter((c) => c.name.startsWith("_vercel"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  if (vercelCookies) headers.cookie = vercelCookies;

  const res = await fetch(new URL(pathname, origin), { headers, redirect: "manual" });
  const html = await res.text();
  const isHtml = (res.headers.get("content-type") ?? "").includes("text/html");
  if (res.status !== 200 || !isHtml) return null;
  // A page rendered per request carries the nonce Next stamped on it, and
  // says so in its cache headers; hashing it would pin one render only.
  if (/private/.test(res.headers.get("cache-control") ?? "") || /<script[^>]*\snonce=/i.test(html)) return null;
  return inlineScriptHashes(html);
}

/**
 * The hashes to pin for this request's page, or null when the page is
 * rendered per request (nonce policy). Throws when the page could not be
 * fetched, so the caller decides how to degrade.
 */
export function pageScriptHashes(request: NextRequest): Promise<Verdict> {
  const { pathname } = request.nextUrl;
  const known = verdicts.get(pathname);
  if (known !== undefined) return Promise.resolve(known);
  const pending = inFlight.get(pathname);
  if (pending) return pending;
  const task = probe(request)
    .then((verdict) => remember(pathname, verdict))
    .finally(() => inFlight.delete(pathname));
  inFlight.set(pathname, task);
  return task;
}

/** For tests. */
export function forgetPageScriptHashes(): void {
  verdicts.clear();
  inFlight.clear();
}
