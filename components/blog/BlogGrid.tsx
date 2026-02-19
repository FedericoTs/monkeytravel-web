"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { BlogCard } from "@/components/blog";
import type { BlogFrontmatter } from "@/lib/blog/types";

const POSTS_PER_PAGE = 6;

interface BlogGridProps {
  posts: BlogFrontmatter[];
}

export default function BlogGrid({ posts }: BlogGridProps) {
  const t = useTranslations("blog");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Extract unique categories from posts
  const categories = useMemo(() => {
    const cats = new Set(posts.map((p) => p.category));
    return Array.from(cats).sort();
  }, [posts]);

  // Filter posts by category
  const filteredPosts = useMemo(() => {
    if (!activeCategory) return posts;
    return posts.filter((p) => p.category === activeCategory);
  }, [posts, activeCategory]);

  // Pagination
  const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
  const paginatedPosts = filteredPosts.slice(
    (currentPage - 1) * POSTS_PER_PAGE,
    currentPage * POSTS_PER_PAGE
  );

  // Reset to page 1 when filter changes
  const handleCategoryChange = (category: string | null) => {
    setActiveCategory(category);
    setCurrentPage(1);
  };

  return (
    <div>
      {/* Category Filter */}
      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <button
            onClick={() => handleCategoryChange(null)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeCategory === null
                ? "bg-[var(--primary)] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t("filter.all")}
          </button>
          {categories.map((cat) => {
            let categoryLabel: string;
            try {
              categoryLabel = t(`categories.${cat}`);
            } catch {
              categoryLabel = cat;
            }
            return (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-[var(--primary)] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {categoryLabel}
              </button>
            );
          })}
        </div>
      )}

      {/* Post count */}
      <p className="text-sm text-slate-500 mb-6">
        {t("filter.showing", {
          count: filteredPosts.length,
          total: posts.length,
        })}
      </p>

      {/* Post Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {paginatedPosts.map((post) => {
          let postTitle: string;
          let postDescription: string;
          let categoryLabel: string;
          try {
            postTitle = t(`posts.${post.slug}.title`);
          } catch {
            postTitle = post.title;
          }
          try {
            postDescription = t(`posts.${post.slug}.description`);
          } catch {
            postDescription = post.description;
          }
          try {
            categoryLabel = t(`categories.${post.category}`);
          } catch {
            categoryLabel = post.category;
          }
          return (
            <BlogCard
              key={post.slug}
              post={post}
              title={postTitle}
              description={postDescription}
              category={categoryLabel}
              readMoreLabel={t("index.readMore")}
              minuteReadLabel={t("index.minuteRead", {
                minutes: post.readingTime,
              })}
            />
          );
        })}
      </div>

      {/* Empty state */}
      {filteredPosts.length === 0 && (
        <div className="text-center py-16">
          <p className="text-slate-500 text-lg">{t("filter.noResults")}</p>
          <button
            onClick={() => handleCategoryChange(null)}
            className="mt-4 text-[var(--primary)] font-medium hover:underline"
          >
            {t("filter.clearFilter")}
          </button>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2 mt-12" aria-label="Pagination">
          {/* Previous */}
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-slate-100 text-slate-600 hover:bg-slate-200"
            aria-label={t("pagination.previous")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Page numbers */}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                currentPage === page
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              aria-label={t("pagination.page", { page })}
              aria-current={currentPage === page ? "page" : undefined}
            >
              {page}
            </button>
          ))}

          {/* Next */}
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-slate-100 text-slate-600 hover:bg-slate-200"
            aria-label={t("pagination.next")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </nav>
      )}
    </div>
  );
}
