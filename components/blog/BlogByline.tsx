import Image from "next/image";

interface BlogBylineProps {
  authorLabel: string;
  publishedDate: string;
  updatedDate: string | null;
  readingTime: number;
  publishedLabel: string;
  updatedLabel: string | null;
  minuteReadLabel: string;
  logoAlt: string;
}

/**
 * Institutional byline rendered at the top of the article body.
 * Reinforces brand authorship without a personal-author face.
 */
export default function BlogByline({
  authorLabel,
  publishedDate,
  updatedDate,
  publishedLabel,
  updatedLabel,
  minuteReadLabel,
  logoAlt,
}: BlogBylineProps) {
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
