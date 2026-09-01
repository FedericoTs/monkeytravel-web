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
 * Exact user-agent strings observed operating a fleet, not a browser.
 *
 * SEPARATE FROM BOT_SIGNATURES ON PURPOSE. That list is a substring test for
 * self-declared automation, and the header above promises it stays that way.
 * This one is an allow-nothing exact match for plain-Chrome strings we have
 * positively identified as non-human from behaviour, so the two rules never
 * blur into "anything that looks a bit odd".
 *
 * The evidence required before a string goes in here is a session count in the
 * tens of thousands with ZERO signed-in users. Measured 2026-09-01 for the
 * entry below:
 *
 *   rows                     203,038   (37% of all page_views_human)
 *   sessions                  68,432
 *   sessions with a user_id        0   <-- the disqualifier
 *   countries                     43
 *   avg views/session           2.97   (5.68 for everyone else)
 *   Chrome version pinned at 149.0.0.0 since 2026-06-10
 *
 * Real Chrome auto-updates; a fleet frozen on one build for three months
 * across 43 countries is not 68,432 people. Every other X11/Linux variant in
 * the data is 1-3 orders of magnitude smaller with plausible ratios, so this
 * deliberately does NOT match "X11; Linux" generally - desktop Linux users are
 * real, just rare, and excluding all of them would be a worse error.
 *
 * MAINTENANCE: this rots. When the fleet moves to Chrome/150 the string stops
 * matching and the traffic reappears. Re-run the query in
 * scripts/audit-automation-ua.mts (or the one in this comment) when the
 * dashboard jumps without a release to explain it.
 */
const AUTOMATION_EXACT_UA: readonly string[] = [
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
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
  // Exact match first: cheap, and it is the single biggest contributor.
  if (AUTOMATION_EXACT_UA.includes(userAgent)) return true;
  const ua = userAgent.toLowerCase();
  return BOT_SIGNATURES.some((sig) => ua.includes(sig));
}

/** Exported for the SQL backfill and for tests to assert coverage. */
export const BOT_SIGNATURE_LIST = BOT_SIGNATURES;

/** Exported for the same backfill: these need an equality test, not LIKE. */
export const AUTOMATION_EXACT_UA_LIST = AUTOMATION_EXACT_UA;
