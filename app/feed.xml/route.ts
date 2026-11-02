import { blogFeedResponse } from "@/lib/blog/feed";

// Built once and refreshed hourly, like sitemap-trips.xml: the feed only
// needs front matter, so it never renders the posts themselves.
export const revalidate = 3600;

export function GET() {
  return blogFeedResponse("en");
}
