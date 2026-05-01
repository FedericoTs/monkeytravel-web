import { Link } from "@/lib/i18n/routing";
import type { BlogFrontmatter } from "@/lib/blog/types";
import { BlogCard } from "@/components/blog";
import { useTranslations } from "next-intl";

interface BlogLaneProps {
  title: string;
  description?: string;
  posts: BlogFrontmatter[];
  /** Optional link target for the lane header (e.g. tag or category page). */
  viewAllHref?: string;
  viewAllLabel?: string;
  /**
   * Translation namespace under "blog" — used to render each card's title /
   * description / category from messages JSON. Default 'blog'.
   */
  // (not currently parameterized — using top-level useTranslations below)
}

/**
 * Curated lane on the blog index. Title row + (optional view-all link) +
 * 3-column responsive grid of BlogCards. Renders nothing when posts is
 * empty so callers don't have to gate.
 */
export default function BlogLane({ title, description, posts, viewAllHref, viewAllLabel }: BlogLaneProps) {
  const t = useTranslations("blog");

  if (posts.length === 0) return null;

  return (
    <section className="py-10 sm:py-12">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{title}</h2>
          {description && (
            <p className="mt-1 text-sm sm:text-base text-slate-500 leading-relaxed">{description}</p>
          )}
        </div>
        {viewAllHref && viewAllLabel && (
          <Link
            href={viewAllHref}
            className="hidden sm:inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[var(--primary)] hover:gap-2.5 transition-all"
          >
            {viewAllLabel}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        {posts.map((post) => (
          <BlogCard
            key={post.slug}
            post={post}
            title={t(`posts.${post.slug}.title`)}
            description={t(`posts.${post.slug}.description`)}
            category={t(`categories.${post.category}`)}
            readMoreLabel={t("index.readMore")}
            minuteReadLabel={t("index.minuteRead", { minutes: post.readingTime })}
          />
        ))}
      </div>
    </section>
  );
}
