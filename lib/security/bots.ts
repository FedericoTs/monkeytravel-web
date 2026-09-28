/**
 * User agents refused at the edge (middleware.ts) and told so in robots.txt
 * (app/robots.ts): training-only scrapers, content resellers and SEO-tool
 * crawlers, none of which brings citation surface. Search engines and AI
 * citation agents are deliberately absent; middleware.ts explains why.
 */
export const BLOCKED_BOT_AGENTS = [
  "anthropic-ai",
  "CCBot", // Common Crawl
  "Bytespider", // ByteDance/TikTok
  "Amazonbot",
  "FacebookBot",
  "Meta-ExternalAgent",
  "Diffbot",
  "SemrushBot",
  "AhrefsBot",
  "MJ12bot",
  "DotBot",
] as const;

/** Whether a request's User-Agent names one of the blocked crawlers. */
export function isBlockedBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BLOCKED_BOT_AGENTS.some((name) => ua.includes(name.toLowerCase()));
}
