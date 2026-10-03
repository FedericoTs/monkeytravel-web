import { Link } from "@/lib/i18n/routing";
import type { TagLink } from "@/lib/blog/tags";

/** Links to blog tag archives, shown as `#tag` like the archive's own heading. */
export default function TopicLinks({
  title,
  tags,
  className,
}: {
  title: string;
  tags: TagLink[];
  className?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <nav aria-label={title} className={className}>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {tags.map(({ slug, display }) => (
          <li key={slug}>
            <Link
              href={`/blog/tag/${slug}`}
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-4 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--primary)]"
            >
              #{display}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
