import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import TemplatesPageClient from "./TemplatesPageClient";

/**
 * Locale-aware metadata for /templates ("Curated Escapes").
 *
 * Previously this was a static `export const metadata = { title: "Curated
 * Escapes" }` which leaked English copy onto /it and /es. Live-caught
 * 2026-05-31: `<title>` on /it/templates rendered "Curated Escapes |
 * MonkeyTravel" while every other surface on the locale was Italian.
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
  return {
    title,
    description,
    openGraph: {
      title: `${title} | MonkeyTravel`,
      description,
      type: "website",
    },
  };
}

export default function TemplatesPage() {
  return <TemplatesPageClient />;
}
