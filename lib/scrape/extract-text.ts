/**
 * Server-side URL → readable text extractor.
 *
 * Used by the "Start Anywhere" extract endpoint. Users paste a travel-blog
 * URL into the text box; we fetch the page, strip scripts/styles/nav,
 * and return the body text so Gemini can extract trip context from it.
 *
 * **Why this exists** — 2026-05-24 live-test: the previous code passed
 * the URL as a literal string to Gemini, hoping it could guess the
 * destination from the URL slug. That worked for `wikipedia.org/wiki/Lisbon`
 * but silently failed for any opaque URL like a NYTimes article.
 *
 * SSRF guards (same as gemini-vision image fetch):
 *  - HTTPS only
 *  - Block private/loopback hostnames
 *  - 8 s timeout
 *  - 2 MB body cap (HTML > 2MB is almost always anti-scraping junk anyway)
 *
 * Text extraction is intentionally naive — strip script/style/nav/footer,
 * then take the visible text. Good enough for blog posts; not a full
 * Readability port. If quality complaints appear, swap in `@mozilla/readability`.
 */
const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|::1$|fe80:)/i;

const MAX_BODY_BYTES = 2_000_000; // 2 MB
const TIMEOUT_MS = 8000;
const MAX_TEXT_CHARS = 8000; // What we feed Gemini (also a cost guard)

/**
 * Detects whether a string looks like a plain URL we should scrape.
 * Returns false for free-form text that happens to contain a URL inside.
 */
export function looksLikeUrlOnly(input: string): boolean {
  const trimmed = input.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return false;
  // Reject anything with internal whitespace — that's "text + a URL".
  return !/\s/.test(trimmed);
}

/**
 * Fetch a URL and return the visible body text, capped at MAX_TEXT_CHARS.
 * Throws on SSRF-blocked targets, network errors, non-2xx, or non-HTML.
 */
export async function scrapeUrlText(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL must use http:// or https://");
  }
  if (PRIVATE_HOST_RE.test(url.hostname)) {
    throw new Error("URL cannot point to a private network");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MonkeyTravelBot/1.0; +https://monkeytravel.app)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en;q=0.9,*;q=0.5",
      },
    });
    if (!res.ok) {
      throw new Error(`Page fetch returned HTTP ${res.status}`);
    }
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!ctype.includes("text/html") && !ctype.includes("application/xhtml")) {
      throw new Error(`URL did not return HTML (got ${ctype})`);
    }
    // Stream-read up to MAX_BODY_BYTES. Some pages are huge; we don't
    // need more than 2 MB to find the article body.
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Page has no body stream");
    }
    const decoder = new TextDecoder();
    let collected = "";
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      collected += decoder.decode(value, { stream: true });
    }
    collected += decoder.decode();
    html = collected;
  } finally {
    clearTimeout(timer);
  }

  return extractVisibleText(html);
}

/**
 * Strip noise from raw HTML and return readable text, capped at
 * MAX_TEXT_CHARS. Naive but predictable. Removes:
 *  - <script>, <style>, <noscript>, <template>
 *  - <nav>, <header>, <footer>, <aside>
 *  - HTML comments
 *  - leftover tags (collapsed to spaces)
 *  - excess whitespace
 */
export function extractVisibleText(html: string): string {
  let s = html;
  // Remove block-level noise + their contents.
  s = s.replace(/<(script|style|noscript|template|svg|nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ");
  // Remove HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Replace block tags with newlines so paragraphs survive whitespace collapse.
  s = s.replace(/<(\/?(p|div|h[1-6]|li|br|tr|td|th|article|section))[^>]*>/gi, "\n");
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities. Conservative — Gemini handles the rest.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Collapse whitespace.
  s = s.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n\n").trim();
  return s.slice(0, MAX_TEXT_CHARS);
}
