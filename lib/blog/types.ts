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
}

export interface BlogPost {
  frontmatter: BlogFrontmatter;
  content: string; // raw markdown
  html: string; // rendered HTML
}
