import { getTranslations } from "next-intl/server";
import { buildAlternates } from "@/lib/seo/canonical";
import {
  generateBreadcrumbSchema,
  generateFAQSchema,
  generateWebPageSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";

/**
 * The page's FAQPage, BreadcrumbList and WebPage structured data. The
 * breadcrumb names come from `breadcrumbs.home` and `breadcrumbs.<namespace>`;
 * `faqItems` are the questions the page's FAQ shows.
 */
export default async function LandingStructuredData({
  namespace,
  locale,
  path,
  contentUpdated,
  faqItems,
}: {
  namespace: string;
  locale: string;
  path: string;
  contentUpdated: string;
  faqItems: { question: string; answer: string }[];
}) {
  const t = await getTranslations(namespace);
  const page = { name: t(`breadcrumbs.${namespace}`), url: buildAlternates(path, { locale }).canonical };
  const home = { name: t("breadcrumbs.home"), url: buildAlternates("", { locale }).canonical };
  return (
    <script
      {...jsonLdScriptProps([
        generateFAQSchema(faqItems),
        generateBreadcrumbSchema([home, page]),
        generateWebPageSchema({ name: page.name, url: page.url, dateModified: contentUpdated }),
      ])}
    />
  );
}
