import Image from "next/image";
import { Sparkles } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@supabase/supabase-js";
import { proxyImageUrl } from "@/lib/img/proxyUrl";
import { countryName, templateText } from "@/lib/templates/text";
import { SeeAllCard, TemplateCard, type TemplateTrip } from "./TemplateCard";

async function fetchTemplates(limit: number, locale: string): Promise<TemplateTrip[]> {
  try {
    // Cookie-free anon client: public templates need no session, and reading
    // cookies would pin the homepage to a per-request render.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return [];
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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

    return data.map((t) => {
      const text = templateText(t.id, locale, {
        title: t.title,
        short: t.template_short_description || t.description || "",
        full: t.description || "",
      });
      return {
        id: t.id,
        title: text.title,
        description: text.short,
        destination: t.template_destination || "",
        country: countryName(t.template_country_code || "", locale, t.template_country || ""),
        countryCode: t.template_country_code || "",
        coverImageUrl: t.cover_image_url || "",
        durationDays: t.template_duration_days || 0,
        budgetTier: (t.template_budget_tier as TemplateTrip["budgetTier"]) || "moderate",
        moodTags: t.template_mood_tags || [],
        copyCount: t.template_copy_count || 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Server component — fetches and renders curated trip templates with native
 * horizontal scroll. Was previously client-side which hid the template links
 * from Googlebot. Each card emits a real <a href="/trips/template/{id}"> in
 * the initial SSR HTML for crawl discoverability.
 */
export default async function CuratedEscapes() {
  const t = await getTranslations("common.curatedEscapes");
  const templates = await fetchTemplates(6, await getLocale());

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
              <TemplateCard
                template={template}
                t={t}
                coverMissing={!template.coverImageUrl}
                image={
                  // Same-origin proxy: direct browser loads to Pexels intermittently
                  // 504 (see lib/img/proxyUrl.ts).
                  template.coverImageUrl && (
                    <Image
                      src={proxyImageUrl(template.coverImageUrl) || template.coverImageUrl}
                      alt={template.title}
                      fill
                      unoptimized
                      sizes="300px"
                      loading="lazy"
                      className="object-cover transition-all duration-500 group-hover:scale-105"
                    />
                  )
                }
              />
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
