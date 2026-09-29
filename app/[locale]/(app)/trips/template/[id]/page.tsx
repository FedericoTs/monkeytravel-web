import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TemplatePreviewClient from "./TemplatePreviewClient";
import { refreshItineraryPhotos } from "@/lib/places/refreshItineraryPhotos";
import { countryName, templateItinerary, templateMeta, templatePacking, templateText } from "@/lib/templates/text";

interface TemplatePageProps {
  params: Promise<{ id: string; locale: string }>;
}

export async function generateMetadata({ params }: TemplatePageProps) {
  const { id, locale } = await params;
  const supabase = await createClient();

  const { data: template } = await supabase
    .from("trips")
    .select("id, title, description, template_destination, template_short_description")
    .eq("id", id)
    .eq("is_template", true)
    .single();

  if (!template) {
    return { title: "Template Not Found" };
  }

  const text = templateText(template.id, locale, {
    title: template.title,
    short: template.template_short_description || "",
    full: template.description || "",
  });

  return {
    // Strip brand suffix — root layout's title.template adds it.
    title: `${template.template_destination} Trip`,
    description: text.short || `Explore our curated ${template.template_destination} itinerary`,
  };
}

export default async function TemplatePage({ params }: TemplatePageProps) {
  const { id, locale } = await params;
  const supabase = await createClient();

  const { data: template, error } = await supabase
    .from("trips")
    .select(`
      id,
      title,
      description,
      start_date,
      end_date,
      cover_image_url,
      tags,
      budget,
      itinerary,
      trip_meta,
      packing_list,
      template_mood_tags,
      template_duration_days,
      template_budget_tier,
      template_destination,
      template_country,
      template_country_code,
      template_copy_count,
      template_short_description
    `)
    .eq("id", id)
    .eq("is_template", true)
    .eq("visibility", "public")
    .single();

  if (error || !template) {
    notFound();
  }

  // Calculate date range for display (generic, will be customized on save)
  const durationDays = template.template_duration_days || template.itinerary?.length || 7;

  // Read-time refresh of activity photo URLs from places_v2 — templates
  // are public-facing and any stale URL renders as a broken-image icon
  // on the preview page. See lib/places/refreshItineraryPhotos.ts.
  const refreshedItinerary = await refreshItineraryPhotos(
    Array.isArray(template.itinerary) ? template.itinerary : []
  );

  const text = templateText(template.id, locale, {
    title: template.title,
    short: template.template_short_description || template.description,
    full: template.description,
  });

  return (
    <TemplatePreviewClient
      template={{
        id: template.id,
        title: text.title,
        description: text.short,
        fullDescription: text.full,
        destination: template.template_destination || template.title.replace(/ Trip$/, ""),
        country: countryName(template.template_country_code || "", locale, template.template_country || ""),
        countryCode: template.template_country_code || "",
        coverImageUrl: template.cover_image_url,
        durationDays,
        budgetTier: template.template_budget_tier || "moderate",
        moodTags: template.template_mood_tags || [],
        tags: template.tags || [],
        copyCount: template.template_copy_count || 0,
        itinerary: templateItinerary(template.id, locale, refreshedItinerary),
        meta: templateMeta(template.id, locale, template.trip_meta ?? {}),
        budget: template.budget,
        packingList: templatePacking(template.id, locale, template.packing_list || []),
      }}
    />
  );
}
