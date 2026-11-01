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
 * Self-declared bots are a large and changing share of page views. Counted as
 * visitors, they can make traffic look like it is growing while the real
 * audience shrinks.
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
  // Our own tooling: anything we run against prod announces itself with a
  // "monkeytravel-<tool>/<n> (+internal)" UA. A sweep writes many rows in
  // seconds and matches no signature above, so it is labelled at write time
  // and never reaches page_views_human.
  "monkeytravel-",
  "(+internal)",
  // Checkers and scripts that name themselves without the convention above:
  // single views, no referrer, never signed in.
  "undici",
  "vibecheck",
  "freescan",
  "buildhopframecheck",
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
 * tens of thousands with ZERO signed-in users. The entry below is a Linux
 * Chrome frozen on one build across dozens of countries, with no signed-in
 * session at all; real Chrome auto-updates. Every other X11/Linux variant in
 * the data is orders of magnitude smaller with plausible ratios, so this
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
  // The bare product token with nothing after it. No browser sends this;
  // HTTP libraries whose default UA was trimmed do: single views, never
  // signed in, arriving in bursts that read as traffic spikes.
  "Mozilla/5.0",
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
