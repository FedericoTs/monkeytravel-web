import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import TemplatesPageClient from "./TemplatesPageClient";
import { ogImages } from "@/lib/seo/og-image";
import { buildAlternates } from "@/lib/seo/canonical";

/**
 * Locale-aware metadata for /templates ("Curated Escapes").
 *
 * Generated per locale, so /it and /es don't get an English `<title>`.
 *
 * Keys live under `common.curatedEscapes.meta.{title,description}` —
 * sibling of the existing `title` + `subtitle` that already had IT/ES
 * translations.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.curatedEscapes.meta" });
  const title = t("title");
  const description = t("description");
  const { canonical, languages } = buildAlternates("/templates", { locale });
  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      siteName: "MonkeyTravel",
      title: `${title} | MonkeyTravel`,
      description,
      type: "website",
      url: canonical,
      images: ogImages(`${title} | MonkeyTravel`),
    },
  };
}

export default function TemplatesPage() {
  return <TemplatesPageClient />;
}
