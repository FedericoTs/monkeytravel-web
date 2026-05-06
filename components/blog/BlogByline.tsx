import Image from "next/image";
import Link from "next/link";

interface BlogBylineAuthor {
  /** Display name */
  name: string;
  /** Job title shown under the name */
  title: string;
  /** Absolute URL to the author bio page */
  bioUrl: string;
  /** Path to the author headshot (relative to /public) */
  photoUrl: string;
}

interface BlogBylineProps {
  /** When provided, renders a named author byline. When omitted, falls back
   *  to the institutional MonkeyTravel logo byline (legacy behavior). */
  author?: BlogBylineAuthor;
  authorLabel: string;
  publishedDate: string;
  updatedDate: string | null;
  readingTime: number;
  publishedLabel: string;
  updatedLabel: string | null;
  minuteReadLabel: string;
  logoAlt: string;
}

export default function BlogByline({
  author,
  authorLabel,
  publishedDate,
  updatedDate,
  publishedLabel,
  updatedLabel,
  minuteReadLabel,
  logoAlt,
}: BlogBylineProps) {
  // Named-author variant: photo + name + title, links to author page
  if (author) {
    return (
      <div className="flex items-center gap-4">
        <Link
          href={author.bioUrl}
          className="shrink-0 w-11 h-11 rounded-full overflow-hidden bg-gradient-to-br from-[var(--primary)]/20 to-[var(--accent)]/30 ring-2 ring-white"
          aria-label={`View ${author.name}'s author page`}
        >
          <Image
            src={author.photoUrl}
            alt={author.name}
            width={44}
            height={44}
            unoptimized
            className="w-full h-full object-cover"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <Link
              href={author.bioUrl}
              className="font-semibold text-slate-900 hover:text-[var(--primary)] transition-colors"
            >
              {author.name}
            </Link>
            <span className="text-slate-500 font-normal"> · {author.title}</span>
          </p>
          <p className="text-xs text-slate-500 mt-0.5 leading-snug">
            {publishedLabel}
            <span className="mx-1.5 text-slate-300">·</span>
            {minuteReadLabel}
            {updatedDate && updatedLabel && (
              <>
                <span className="mx-1.5 text-slate-300">·</span>
                <span className="text-[var(--primary)] font-medium">{updatedLabel}</span>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  // Legacy institutional byline — kept for fallback when no author is set
  return (
    <div className="flex items-center gap-4">
      <div className="shrink-0 w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
        <Image
          src="/images/logo.png"
          alt={logoAlt}
          width={36}
          height={36}
          unoptimized
          className="w-7 h-7 object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 text-sm">{authorLabel}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-snug">
          {publishedLabel}
          <span className="mx-1.5 text-slate-300">·</span>
          {minuteReadLabel}
          {updatedDate && updatedLabel && (
            <>
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="text-[var(--primary)] font-medium">{updatedLabel}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
