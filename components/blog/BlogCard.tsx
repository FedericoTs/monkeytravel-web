import Image from "next/image";
import { Link } from "@/lib/i18n/routing";
import type { BlogFrontmatter } from "@/lib/blog/types";

interface BlogCardProps {
  post: BlogFrontmatter;
  readMoreLabel: string;
  minuteReadLabel: string;
}

export default function BlogCard({
  post,
  readMoreLabel,
  minuteReadLabel,
}: BlogCardProps) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block rounded-2xl overflow-hidden bg-white border border-gray-100 hover:border-[var(--accent)]/30 hover:shadow-xl transition-all"
    >
      {/* Image */}
      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-[var(--primary)]/20 to-[var(--accent)]/20">
        <Image
          src={post.image}
          alt={post.imageAlt}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          loading="lazy"
        />
        {/* Category badge */}
        <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-[var(--primary)] text-white text-xs font-medium">
          {post.category}
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <h3 className="text-lg font-bold text-[var(--foreground)] mb-2 group-hover:text-[var(--primary)] transition-colors line-clamp-2">
          {post.title}
        </h3>

        <p className="text-sm text-[var(--foreground-muted)] mb-4 line-clamp-2">
          {post.description}
        </p>

        {/* Meta row */}
        <div className="flex items-center justify-between text-sm text-[var(--foreground-muted)]">
          <span>{minuteReadLabel}</span>
          <span className="text-[var(--primary)] font-semibold group-hover:underline">
            {readMoreLabel} &rarr;
          </span>
        </div>
      </div>
    </Link>
  );
}
