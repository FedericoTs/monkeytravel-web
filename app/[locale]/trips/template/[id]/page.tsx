import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TemplatePreviewClient from "./TemplatePreviewClient";

interface TemplatePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: TemplatePageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: template } = await supabase
    .from("trips")
    .select("title, template_destination, template_short_description")
    .eq("id", id)
    .eq("is_template", true)
    .single();

  if (!template) {
    return { title: "Template Not Found" };
  }

  return {
    title: `${template.template_destination} Trip | MonkeyTravel`,
    description: template.template_short_description || `Explore our curated ${template.template_destination} itinerary`,
  };
}

export default async function TemplatePage({ params }: TemplatePageProps) {
  const { id } = await params;
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

  return (
    <TemplatePreviewClient
      template={{
        id: template.id,
        title: template.title,
        description: template.template_short_description || template.description,
        fullDescription: template.description,
        destination: template.template_destination || template.title.replace(/ Trip$/, ""),
        country: template.template_country || "",
        countryCode: template.template_country_code || "",
        coverImageUrl: template.cover_image_url,
        durationDays,
        budgetTier: template.template_budget_tier || "moderate",
        moodTags: template.template_mood_tags || [],
        tags: template.tags || [],
        copyCount: template.template_copy_count || 0,
        itinerary: template.itinerary || [],
        meta: template.trip_meta,
        budget: template.budget,
        packingList: template.packing_list || [],
      }}
    />
  );
}
