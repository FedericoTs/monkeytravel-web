/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { previewClient } from "./preview-client";

describe("previewClient", () => {
  it("names the chat apps that unfurl shared links", () => {
    expect(previewClient("WhatsApp/2.24.19.86 A")).toBe("whatsapp");
    expect(
      previewClient(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
      ),
    ).toBe("imessage");
    expect(previewClient("TelegramBot (like TwitterBot)")).toBe("telegram");
    expect(previewClient("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe("facebook");
    expect(previewClient("Twitterbot/1.0")).toBe("x");
    expect(previewClient("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe("slack");
    expect(previewClient("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)")).toBe("discord");
    expect(previewClient("LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)")).toBe("linkedin");
  });

  it("separates search crawlers, people and everything else", () => {
    expect(previewClient("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("search");
    expect(
      previewClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"),
    ).toBe("browser");
    expect(previewClient("curl/8.4.0")).toBe("other");
    expect(previewClient("")).toBe("other");
    expect(previewClient(null)).toBe("other");
  });
});
