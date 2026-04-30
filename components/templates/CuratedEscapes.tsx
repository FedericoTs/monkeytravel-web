import Link from "next/link";
import Image from "next/image";
import { Sparkles, ChevronRight, Users, ArrowRight, MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

interface TemplateTrip {
  id: string;
  title: string;
  description: string;
  destination: string;
  country: string;
  countryCode: string;
  coverImageUrl: string;
  durationDays: number;
  budgetTier: "budget" | "moderate" | "luxury";
  moodTags: string[];
  copyCount: number;
}

const MOOD_EMOJIS: Record<string, string> = {
  romantic: "💕",
  adventure: "🏔️",
  cultural: "🏛️",
  relaxation: "🌴",
  foodie: "🍝",
  family: "👨‍👩‍👧‍👦",
  nature: "🌿",
  offbeat: "🧭",
  urban: "🏙️",
  wellness: "🧘",
};

function getFlagEmoji(countryCode: string): string {
  if (!countryCode) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

const DESTINATION_GRADIENTS: Record<string, { from: string; to: string }> = {
  paris: { from: "#E8B4B8", to: "#D4919A" },
  rome: { from: "#C9A86C", to: "#9E7B4F" },
  tokyo: { from: "#FFB7C5", to: "#FF6B9D" },
  barcelona: { from: "#F6AD55", to: "#ED8936" },
  bali: { from: "#4FD1C5", to: "#38B2AC" },
  london: { from: "#6B7B8C", to: "#4A5568" },
  dubai: { from: "#D69E2E", to: "#B7791F" },
  amsterdam: { from: "#68D391", to: "#48BB78" },
  santorini: { from: "#63B3ED", to: "#4299E1" },
  iceland: { from: "#A0AEC0", to: "#718096" },
  "new york": { from: "#667EEA", to: "#764BA2" },
  default: { from: "#718096", to: "#4A5568" },
};

function getGradient(destination: string) {
  const key = destination.toLowerCase().split(",")[0].trim();
  return DESTINATION_GRADIENTS[key] || DESTINATION_GRADIENTS.default;
}

async function fetchTemplates(limit = 6): Promise<TemplateTrip[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("trips")
      .select(`
        id, title, description, cover_image_url,
        template_mood_tags, template_duration_days, template_budget_tier,
        template_destination, template_country, template_country_code,
        template_featured_order, template_copy_count, template_short_description
      `)
      .eq("is_template", true)
      .eq("visibility", "public")
      .order("template_featured_order", { ascending: true, nullsFirst: false })
      .order("template_copy_count", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.template_short_description || t.description || "",
      destination: t.template_destination || "",
      country: t.template_country || "",
      countryCode: t.template_country_code || "",
      coverImageUrl: t.cover_image_url || "",
      durationDays: t.template_duration_days || 0,
      budgetTier: (t.template_budget_tier as TemplateTrip["budgetTier"]) || "moderate",
      moodTags: t.template_mood_tags || [],
      copyCount: t.template_copy_count || 0,
    }));
  } catch {
    return [];
  }
}

interface TemplateCardProps {
  template: TemplateTrip;
  t: Awaited<ReturnType<typeof getTranslations<"common.curatedEscapes">>>;
}

function TemplateCard({ template, t }: TemplateCardProps) {
  const gradient = getGradient(template.destination);
  const budgetLabel =
    template.budgetTier === "budget"
      ? "€"
      : template.budgetTier === "moderate"
      ? "€€"
      : "€€€";

  return (
    <Link
      href={`/trips/template/${template.id}`}
      className="group bg-white rounded-2xl border border-slate-200/80 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-slate-300 hover:-translate-y-1 block flex-shrink-0 active:scale-[0.98] w-[260px] md:w-[300px]"
    >
      <div
        className="aspect-[4/3] relative overflow-hidden"
        style={{
          background: !template.coverImageUrl
            ? `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`
            : undefined,
        }}
      >
        {template.coverImageUrl && (
          <Image
            src={template.coverImageUrl}
            alt={template.title}
            fill
            unoptimized
            sizes="300px"
            loading="lazy"
            className="object-cover transition-all duration-500 group-hover:scale-105"
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        <div className="absolute top-3 left-3 right-3 flex justify-between items-start">
          <span className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/95 backdrop-blur-sm text-slate-700 shadow-sm">
            {t("days", { days: template.durationDays })}
          </span>
          <span className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-400/95 backdrop-blur-sm text-amber-900 shadow-sm">
            {budgetLabel}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg drop-shadow-md">{getFlagEmoji(template.countryCode)}</span>
            <span className="text-white/90 text-xs font-medium tracking-wide uppercase">{template.country}</span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white drop-shadow-lg leading-tight line-clamp-1">
            {template.destination}
          </h3>
        </div>
      </div>

      <div className="p-4">
        <p className="text-slate-600 text-sm leading-relaxed line-clamp-2 mb-3">
          {template.description}
        </p>

        <div className="flex gap-2 mb-3">
          {template.moodTags.slice(0, 2).map((mood) => {
            const emoji = MOOD_EMOJIS[mood];
            const moodKey = `moods.${mood}` as Parameters<typeof t>[0];
            return (
              <span
                key={mood}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600"
              >
                {emoji} {t(moodKey)}
              </span>
            );
          })}
          {template.moodTags.length > 2 && (
            <span className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-400">
              +{template.moodTags.length - 2}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            {template.copyCount > 0 && (
              <>
                <Users className="w-4 h-4" />
                {t("used", { count: template.copyCount })}
              </>
            )}
          </span>
          <span className="text-[var(--primary)] font-semibold text-sm flex items-center gap-1 group-hover:gap-2 transition-all py-1">
            {t("explore")}
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function SeeAllCard({ t }: { t: Awaited<ReturnType<typeof getTranslations<"common.curatedEscapes">>> }) {
  return (
    <Link
      href="/templates"
      className="group flex-shrink-0 w-[200px] md:w-[220px] bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 rounded-2xl overflow-hidden relative flex flex-col items-center justify-center hover:shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
      style={{ aspectRatio: "3/4" }}
    >
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[var(--accent)]" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-white" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center px-4">
        <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <MapPin className="w-7 h-7 md:w-8 md:h-8 text-white" />
        </div>

        <h3 className="text-white font-bold text-base md:text-lg mb-1">
          {t("exploreAll")}
        </h3>
        <p className="text-white/70 text-xs mb-4">
          {t("moreCuratedTrips")}
        </p>

        <div className="flex items-center gap-2 text-[var(--accent)] font-semibold text-sm group-hover:gap-3 transition-all">
          <span>{t("browse")}</span>
          <ArrowRight className="w-4 h-4" />
        </div>
      </div>
    </Link>
  );
}

/**
 * Server component — fetches and renders curated trip templates with native
 * horizontal scroll. Was previously client-side which hid the template links
 * from Googlebot. Each card emits a real <a href="/trips/template/{id}"> in
 * the initial SSR HTML for crawl discoverability.
 */
export default async function CuratedEscapes() {
  const t = await getTranslations("common.curatedEscapes");
  const templates = await fetchTemplates(6);

  if (templates.length === 0) {
    return null;
  }

  return (
    <section className="mb-6">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t("title")}</h2>
            <p className="text-sm text-slate-500">{t("subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Templates Carousel — native CSS scroll, no JS */}
      <div className="-mx-4 px-4 md:-mx-6 md:px-6">
        <div
          className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {templates.map((template) => (
            <div key={template.id} className="flex-shrink-0 snap-start">
              <TemplateCard template={template} t={t} />
            </div>
          ))}

          {/* See All Card */}
          <div className="flex-shrink-0 snap-start">
            <SeeAllCard t={t} />
          </div>
        </div>
      </div>
    </section>
  );
}
