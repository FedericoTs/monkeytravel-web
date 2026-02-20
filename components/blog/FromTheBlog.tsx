import { getTranslations } from "next-intl/server";
import { getPostBySlug } from "@/lib/blog/api";
import { BlogCard } from "@/components/blog";

interface FromTheBlogProps {
  slugs: string[];
  locale: string;
}

/**
 * "From the Blog" section for landing pages.
 * Renders 3 blog post cards from pre-selected slugs.
 */
export default async function FromTheBlog({ slugs, locale }: FromTheBlogProps) {
  const tc = await getTranslations("common");
  const tb = await getTranslations("blog");

  const posts = (
    await Promise.all(slugs.map((s) => getPostBySlug(s, locale)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  if (posts.length === 0) return null;

  return (
    <section className="py-20 bg-[var(--background-alt)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] tracking-tight">
            {tc("fromTheBlog.title")}
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {posts.map((post) => (
            <BlogCard
              key={post.frontmatter.slug}
              post={post.frontmatter}
              title={tb(`posts.${post.frontmatter.slug}.title`)}
              description={tb(`posts.${post.frontmatter.slug}.description`)}
              category={tb(`categories.${post.frontmatter.category}`)}
              readMoreLabel={tc("fromTheBlog.readMore")}
              minuteReadLabel={tb("index.minuteRead", {
                minutes: post.frontmatter.readingTime,
              })}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
