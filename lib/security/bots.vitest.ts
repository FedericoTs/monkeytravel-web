import { describe, it, expect } from "vitest";
import { BLOCKED_BOT_AGENTS, isBlockedBotUserAgent } from "./bots";

// The Capacitor app appends this to the system WebView user agent; a match
// here would 403 every install on first launch (tests/e2e/mobile-webview.spec.ts).
const IOS_WEBVIEW_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354 MonkeyTravelApp/1.0";
const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 MonkeyTravelApp/1.0";

describe("isBlockedBotUserAgent", () => {
  it("matches every listed crawler, whatever the case", () => {
    for (const name of BLOCKED_BOT_AGENTS) {
      expect(isBlockedBotUserAgent(`Mozilla/5.0 (compatible; ${name}/2.0; +https://example.com/bot)`)).toBe(true);
      expect(isBlockedBotUserAgent(name.toUpperCase())).toBe(true);
    }
  });

  it("leaves search engines, AI citation agents, browsers and the app alone", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
      "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
      "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      IOS_WEBVIEW_UA,
      ANDROID_WEBVIEW_UA,
    ]) {
      expect(isBlockedBotUserAgent(ua), ua).toBe(false);
    }
    expect(isBlockedBotUserAgent(null)).toBe(false);
    expect(isBlockedBotUserAgent("")).toBe(false);
  });
});
