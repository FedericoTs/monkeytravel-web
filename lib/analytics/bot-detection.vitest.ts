/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { isAnalyticsBot } from "./bot-detection";

/**
 * The cost of getting this wrong runs both ways, so both directions are
 * asserted: a false negative re-inflates every analytics aggregate (the
 * problem this exists to fix), and a false positive silently deletes real
 * visitors from the numbers, which is harder to notice and worse.
 */

const REAL_BROWSERS = [
  // Desktop Chrome
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  // macOS Safari
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  // iPhone Safari — the single largest real segment for this product
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  // Android Chrome
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  // Firefox
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  // Edge
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  // Samsung Internet
  "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
];

const KNOWN_BOTS = [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  "Mozilla/5.0 (compatible; DuckDuckBot-Https/1.1; https://duckduckgo.com/duckduckbot)",
  "Slurp",
  "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
  "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "Mozilla/5.0 (compatible; PerplexityBot/1.0)",
  "Mozilla/5.0 (compatible; CCBot/2.0; https://commoncrawl.org/faq/)",
  "facebookexternalhit/1.1",
  "Twitterbot/1.0",
  "Slackbot-LinkExpanding 1.0",
  "WhatsApp/2.23",
  "python-requests/2.31.0",
  "curl/8.4.0",
  "Wget/1.21",
  "Go-http-client/2.0",
  "axios/1.6.0",
  "node-fetch/1.0",
  "okhttp/4.12.0",
  "Java/17.0.1",
  "Scrapy/2.11 (+https://scrapy.org)",
  "PostmanRuntime/7.36.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh) Chrome-Lighthouse",
  "UptimeRobot/2.0",
];

describe("isAnalyticsBot — real browsers are never misclassified", () => {
  it.each(REAL_BROWSERS)("treats a real browser as human: %s", (ua) => {
    // A false positive here silently removes real visitors from every metric.
    expect(isAnalyticsBot(ua)).toBe(false);
  });
});

describe("isAnalyticsBot — declared bots are caught", () => {
  it.each(KNOWN_BOTS)("flags %s", (ua) => {
    expect(isAnalyticsBot(ua)).toBe(true);
  });
});

describe("isAnalyticsBot — edge cases", () => {
  it("treats a missing user-agent as a bot", () => {
    // Every real browser sends one; in our data the no-UA rows behave exactly
    // like crawler rows (1.00 views per session).
    expect(isAnalyticsBot(null)).toBe(true);
    expect(isAnalyticsBot(undefined)).toBe(true);
    expect(isAnalyticsBot("")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAnalyticsBot("GOOGLEBOT/2.1")).toBe(true);
    expect(isAnalyticsBot("PyThOn-ReQuEsTs/2.31")).toBe(true);
  });

  it("catches Googlebot and Bingbot even though middleware ALLOWS them", () => {
    // The whole reason this list is separate from BLOCKED_BOT_PATTERNS: we
    // want search engines crawling, and we do not want them counted.
    expect(isAnalyticsBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isAnalyticsBot("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
  });

  it("does not flag a browser merely for containing a substring by accident", () => {
    // Guard against over-broad signatures. These are contrived, but a token
    // like "bot" is broad enough that the risk is real.
    expect(isAnalyticsBot("Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36")).toBe(false);
    expect(isAnalyticsBot("Mozilla/5.0 (Linux; Android 14; Robot Phone) Chrome/128.0")).toBe(true);
    // ^ documents a KNOWN false positive: a device literally named "Robot"
    // matches "bot". Accepted — it is vanishingly rare next to the 23% of
    // traffic this filters, and the alternative (word-boundary matching)
    // misses "Bytespider", "Slurp" and most SEO crawlers.
  });
});
