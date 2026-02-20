"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { BlogCard } from "@/components/blog";
import { trackContentInteraction } from "@/lib/analytics";
import { getRegionForPost, ALL_REGIONS } from "@/lib/blog/regions";
import type { BlogRegion } from "@/lib/blog/regions";
import type { BlogFrontmatter } from "@/lib/blog/types";

const POSTS_PER_PAGE = 6;

interface BlogGridProps {
  posts: BlogFrontmatter[];
}

export default function BlogGrid({ posts }: BlogGridProps) {
  const t = useTranslations("blog");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<BlogRegion | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Extract unique categories from posts
  const categories = useMemo(() => {
    const cats = new Set(posts.map((p) => p.category));
    return Array.from(cats).sort();
  }, [posts]);

  // Determine which regions are present in posts
  const regions = useMemo(() => {
    const present = new Set(posts.map((p) => getRegionForPost(p.slug)));
    return ALL_REGIONS.filter((r) => present.has(r));
  }, [posts]);

  // Filter posts by category AND region
  const filteredPosts = useMemo(() => {
    let result = posts;
    if (activeCategory) result = result.filter((p) => p.category === activeCategory);
    if (activeRegion) result = result.filter((p) => getRegionForPost(p.slug) === activeRegion);
    return result;
  }, [posts, activeCategory, activeRegion]);

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
    trackContentInteraction({
      action: "filter",
      content_group: "blog",
      filter_type: "category",
      filter_value: category ?? "all",
    });
  };

  const handleRegionChange = (region: BlogRegion | null) => {
    setActiveRegion(region);
    setCurrentPage(1);
    trackContentInteraction({
      action: "filter",
      content_group: "blog",
      filter_type: "region",
      filter_value: region ?? "all",
    });
  };

  const handleClearFilters = () => {
    setActiveCategory(null);
    setActiveRegion(null);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    trackContentInteraction({
      action: "paginate",
      content_group: "blog",
      page,
      total_pages: totalPages,
    });
  };

  return (
    <div>
      {/* Category Filter */}
      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
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

      {/* Region Filter */}
      {regions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          <button
            onClick={() => handleRegionChange(null)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeRegion === null
                ? "bg-[var(--accent)] text-[var(--foreground)]"
                : "bg-amber-50 text-slate-600 hover:bg-amber-100"
            }`}
          >
            {t("regions.all")}
          </button>
          {regions.map((region) => (
            <button
              key={region}
              onClick={() => handleRegionChange(region)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeRegion === region
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-amber-50 text-slate-600 hover:bg-amber-100"
              }`}
            >
              {t(`regions.${region}`)}
            </button>
          ))}
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
            onClick={handleClearFilters}
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
            onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
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
              onClick={() => handlePageChange(page)}
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
            onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
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
