import { getTranslations } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";

/**
 * Visible links to the same page in the other locales.
 *
 * WHY (2026-09-17)
 * The site declared its translations only through hreflang <link> tags and a
 * language switcher made of buttons, so an English article carried not one
 * crawlable link to its Italian, Spanish or Portuguese version. Of the 112
 * sitemap pages Google had crawled or discovered but not indexed on
 * 2026-09-17, 84 were localized blog posts and destination pages: pages that
 * only other unindexed localized pages linked to. hreflang says "this is the
 * same content in another language"; it passes no link equity. A plain
 * anchor from the indexed English page does.
 *
 * Renders nothing when the page exists in no other locale. Plain <a>, not the
 * router Link: nothing to prefetch, and a crawler reads it as-is.
 */

const NATIVE_NAME: Record<string, string> = {
  en: "English",
  es: "Español",
  it: "Italiano",
  pt: "Português",
};

export function localizedPath(locale: string, path: string): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${prefix}${path}`;
}

interface Props {
  locale: string;
  /** Href for another locale, or null when the page has no version there. */
  hrefFor: (locale: string) => string | null;
  className?: string;
}

export default async function LanguageAlternates({ locale, hrefFor, className }: Props) {
  const links: { locale: string; href: string }[] = [];
  for (const l of routing.locales) {
    if (l === locale) continue;
    const href = hrefFor(l);
    if (href) links.push({ locale: l, href });
  }
  if (links.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "common" });

  return (
    <nav
      aria-label={t("languageAlternates.aria")}
      className={className ?? "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--foreground-muted)]"}
    >
      <span>{t("languageAlternates.label")}</span>
      <ul className="flex flex-wrap items-center gap-x-2">
        {links.map(({ locale: l, href }, i) => (
          <li key={l} className="flex items-center gap-x-2">
            {i > 0 && <span aria-hidden="true">·</span>}
            <a
              href={href}
              lang={l}
              hrefLang={l}
              rel="alternate"
              className="font-medium text-[var(--foreground)] underline-offset-2 hover:underline"
            >
              {NATIVE_NAME[l] ?? l}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
