export interface BlogFrontmatter {
  title: string;
  slug: string;
  description: string;
  author: string;
  publishedAt: string;
  updatedAt: string;
  category: string;
  tags: string[];
  image: string;
  imageAlt: string;
  readingTime: number;
  seo: {
    title: string;
    description: string;
    keywords: string[];
  };
  schema: string;
  /**
   * Optional curated FAQ for FAQPage structured data. When present this is the
   * source of truth for the post's FAQ schema (deterministic); when absent we
   * fall back to scraping a "FAQ / Frequently Asked Questions" section out of
   * the rendered HTML. Authoring this in frontmatter is the reliable path —
   * the HTML scrape silently misses posts that phrase the heading differently.
   */
  faq?: { question: string; answer: string }[];
}

export interface BlogPost {
  frontmatter: BlogFrontmatter;
  content: string; // raw markdown
  html: string; // rendered HTML
}
