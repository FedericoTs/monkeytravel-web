"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";
import BlogCard from "./BlogCard";
import type { BlogFrontmatter } from "@/lib/blog/types";

/** A post with its card text already translated by the server page. */
export interface BlogTip {
  post: BlogFrontmatter;
  title: string;
  description: string;
  category: string;
}

interface BlogTipsSectionProps {
  tips: BlogTip[];
}

export default function BlogTipsSection({ tips }: BlogTipsSectionProps) {
  const t = useTranslations("blog");

  if (tips.length === 0) return null;

  return (
    <section className="mt-10 sm:mt-14 mb-8">
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-[var(--primary-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{t("tips.title")}</h2>
        </div>
        <Link
          href="/blog"
          className="text-sm font-medium text-[var(--primary-ink)] hover:underline"
        >
          {t("tips.viewAll")} &rarr;
        </Link>
      </div>

      {/* Blog cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {tips.map(({ post, title, description, category }) => (
          <BlogCard
            key={post.slug}
            post={post}
            title={title}
            description={description}
            category={category}
            readMoreLabel={t("index.readMore")}
            minuteReadLabel={t("index.minuteRead", { minutes: post.readingTime })}
          />
        ))}
      </div>
    </section>
  );
}
