import { Link } from "@/lib/i18n/routing";
import { START_PHOTOS, photoUrl } from "@/lib/match/photos";

/** The way into "Where should I go?" from a page where someone is still choosing. */
export default function MatchInvite({ title, body, cta, className = "" }: { title: string; body: string; cta: string; className?: string }) {
  return (
    <Link
      href="/where-should-i-go"
      className={`not-prose group relative isolate flex min-h-[380px]! flex-col justify-end overflow-hidden rounded-3xl bg-[#14181a] text-white no-underline sm:min-h-[260px]! sm:flex-row sm:items-center sm:justify-start ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl(START_PHOTOS[0], 1200, 640)}
        alt=""
        loading="lazy"
        className="absolute inset-0 -z-10 m-0! h-full! w-full max-w-none! rounded-none! object-cover transition-transform duration-700 group-hover:scale-[1.03]"
      />
      <span className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(20,24,26,0.15)_0%,rgba(20,24,26,0.88)_78%)] sm:bg-[linear-gradient(90deg,rgba(20,24,26,0.9)_0%,rgba(20,24,26,0.6)_50%,rgba(20,24,26,0.05)_100%)]" />
      <span className="flex max-w-md flex-col gap-2 p-6 sm:p-8">
        <span className="text-[1.75rem] font-semibold leading-tight tracking-tight" style={{ fontFamily: "var(--font-display), Georgia, serif" }}>
          {title}
        </span>
        <span className="text-base leading-snug text-white/90 sm:text-lg">{body}</span>
        <span className="mt-3 inline-flex min-h-[48px] w-fit items-center rounded-full bg-white px-6 text-base font-semibold text-[#14181a]">{cta}</span>
      </span>
    </Link>
  );
}
