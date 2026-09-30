/**
 * Which kind of client fetched a link preview, from its user agent: the app a
 * link was pasted into, a search crawler, or a person's browser. A closed
 * vocabulary, so counts group; the raw user agent is never stored.
 */
export type PreviewClient =
  | "whatsapp"
  | "imessage"
  | "telegram"
  | "facebook"
  | "x"
  | "slack"
  | "discord"
  | "linkedin"
  | "search"
  | "browser"
  | "other";

export function previewClient(userAgent: string | null | undefined): PreviewClient {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "other";
  if (ua.includes("whatsapp")) return "whatsapp";
  // Apple's link previews (Messages) name Facebook's and X's crawlers inside a Safari user agent.
  if (ua.includes("facebookexternalhit") && ua.includes("twitterbot") && ua.includes("safari")) return "imessage";
  if (ua.includes("telegrambot")) return "telegram";
  if (ua.includes("facebookexternalhit") || ua.includes("facebookcatalog") || ua.includes("meta-externalagent")) return "facebook";
  if (ua.includes("twitterbot")) return "x";
  if (ua.includes("slackbot") || ua.includes("slack-imgproxy")) return "slack";
  if (ua.includes("discordbot")) return "discord";
  if (ua.includes("linkedinbot")) return "linkedin";
  if (/googlebot|google-inspectiontool|bingbot|applebot|yandex|duckduckbot|baiduspider/.test(ua)) return "search";
  if (/bot\b|crawl|spider|headless|curl\/|wget|python-requests/.test(ua)) return "other";
  return ua.startsWith("mozilla/") ? "browser" : "other";
}
