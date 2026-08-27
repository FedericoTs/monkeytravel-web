/**
 * Is this user-agent a bot, for ANALYTICS purposes?
 *
 * WHY THIS IS SEPARATE FROM middleware's BLOCKED_BOT_PATTERNS
 * That list answers a different question — "should this crawler be denied
 * access". It deliberately excludes Googlebot, Bingbot and Applebot, because
 * we WANT them crawling. But we do not want them counted as visitors. Two
 * different questions, so two different lists; merging them would either block
 * search engines or inflate the analytics.
 *
 * WHY THIS MATTERS
 * Measured on 2026-08-26: 3,232 of 14,087 page views (23%) came from
 * self-declared bots, up 6.4x in a week. Underneath that, engaged sessions —
 * anyone viewing more than one page — actually FELL from 1,187 to 777 over the
 * same period. The chart said traffic was doubling while the audience shrank.
 * Any decision taken off the raw table was being made on crawler volume.
 *
 * DELIBERATELY CONSERVATIVE
 * This only matches self-declared bots. A crawler presenting a plain Chrome
 * user-agent is indistinguishable from a person at this layer and will still
 * be counted — so treat `is_bot = false` as "not provably a bot", never as
 * "definitely human". The single-page-session heuristic used in ad-hoc
 * analysis stays a query-time concern; encoding it here would misclassify the
 * many real visitors who genuinely read one page and leave.
 */

/**
 * Ordered roughly by frequency in our own logs so the common cases short-
 * circuit first. Each entry is a substring test against a lowercased UA.
 */
const BOT_SIGNATURES: readonly string[] = [
  // Generic self-declaration — catches the long tail, including most
  // search-engine and SEO crawlers that follow convention.
  "bot",
  "crawler",
  "spider",
  "crawling",
  // Search engines that do NOT contain "bot" in their token.
  "slurp", // Yahoo
  "duckduckgo",
  "baiduspider",
  "yandex",
  "sogou",
  "exabot",
  "facebot",
  "ia_archiver", // Alexa / Wayback
  // Headless browsers and automation.
  "headless",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
  // HTTP clients and scripting runtimes.
  "python-requests",
  "python-urllib",
  "aiohttp",
  "httpx",
  "curl/",
  "wget",
  "scrapy",
  "go-http-client",
  "java/",
  "okhttp",
  "axios",
  "node-fetch",
  "got (",
  "libwww-perl",
  "guzzle",
  "postmanruntime",
  // Uptime / preview / link-unfurl agents. These are real requests but they
  // are machines checking a page, not people reading one.
  "uptimerobot",
  "pingdom",
  "statuscake",
  "betteruptime",
  "vercel-screenshot",
  "vercelbot",
  "lighthouse",
  "chrome-lighthouse",
  "pagespeed",
  "gtmetrix",
  // Social/link preview fetchers.
  "facebookexternalhit",
  "whatsapp",
  "telegrambot",
  "slackbot",
  "discordbot",
  "linkedinbot",
  "twitterbot",
  "embedly",
  "quora link preview",
  "skypeuripreview",
  // AI assistants and training crawlers, whether or not we block them.
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "claudebot",
  "claude-user",
  "anthropic-ai",
  "perplexitybot",
  "ccbot",
  "bytespider",
  "google-extended",
  "applebot",
  "amazonbot",
  "meta-externalagent",
  "diffbot",
];

/**
 * True when the user-agent self-identifies as automated.
 *
 * A missing user-agent counts as a bot: every real browser sends one, and in
 * our data the no-UA rows behave exactly like the crawler rows (1.00 views per
 * session).
 */
export function isAnalyticsBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  return BOT_SIGNATURES.some((sig) => ua.includes(sig));
}

/** Exported for the SQL backfill and for tests to assert coverage. */
export const BOT_SIGNATURE_LIST = BOT_SIGNATURES;
