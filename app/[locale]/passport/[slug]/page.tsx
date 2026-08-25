import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "@/lib/i18n/routing";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import {
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";
import { routing } from "@/lib/i18n/routing";
import {
  PASSPORT_PAGE_CODES,
  allPassportSlugs,
  getPassportSummary,
  passportCodeForSlug,
  passportSlug,
} from "@/lib/visa/passport-pages";
import PassportStatusChart from "@/components/passport/PassportStatusChart";
import PassportMap from "@/components/passport/PassportMap";

const BASE_URL = "https://monkeytravel.app";

/**
 * "Where can I actually go with this passport" — one page per passport.
 *
 * This is NOT the passport-index blog post. That post ranks for generic
 * ranking queries ("henley passport index 2026") which Google answers in the
 * SERP and Henley owns — 355,819 impressions, 263 clicks. These pages target
 * the per-passport intent that currently lands on it by mistake ("us passport
 * visa-free countries", "argentine passport visa free countries"), where the
 * answer is a ~198-row table specific to one passport and cannot be compressed
 * into a snippet.
 *
 * Only the 20 passports with measured Search Console demand get a page — see
 * lib/visa/passport-pages.ts for why the list stops there.
 */

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    allPassportSlugs().map((slug) => ({ locale, slug })),
  );
}

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/** Statuses that need paperwork BEFORE you fly, used in the copy below. */
const LABEL_KEYS: Record<string, string> = {
  "visa free": "visaFree",
  "visa on arrival": "visaOnArrival",
  eta: "eta",
  "e-visa": "eVisa",
  "visa required": "visaRequired",
  "no admission": "noAdmission",
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const code = passportCodeForSlug(slug);
  if (!code) return {};
  const summary = getPassportSummary(code, locale);
  if (!summary) return {};

  const t = await getTranslations({ locale, namespace: "passport" });
  // STRICT visa-free count here, not noAdvancePaperwork. The latter folds in
  // visa-on-arrival, and a title that calls those "visa-free" overstates what
  // the passport does — the same class of error that made the ETIAS page wrong.
  const title = t("meta.title", {
    country: summary.name,
    count: summary.counts["visa free"] ?? 0,
  });
  const description = t("meta.description", {
    country: summary.name,
    count: summary.noAdvancePaperwork,
    free: summary.counts["visa free"] ?? 0,
    total: summary.total,
  });

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    const prefix = l === routing.defaultLocale ? "" : `/${l}`;
    languages[l] = `${BASE_URL}${prefix}/passport/${slug}`;
  }
  languages["x-default"] = `${BASE_URL}/passport/${slug}`;

  return {
    // `absolute` opts out of the root "%s | MonkeyTravel" template — the
    // country name and the number are what carry the query, and the 15-char
    // brand suffix would push them past what Google renders.
    title: { absolute: title },
    description,
    alternates: { canonical: languages[locale], languages },
    openGraph: { title, description, url: languages[locale], type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PassportPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const code = passportCodeForSlug(slug);
  if (!code) notFound();

  const summary = getPassportSummary(code, locale);
  if (!summary) notFound();

  const t = await getTranslations("passport");
  const nonce = await getNonce();
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  const breadcrumb = generateBreadcrumbSchema([
    { name: "MonkeyTravel", url: `${BASE_URL}${prefix}` },
    { name: t("breadcrumb"), url: `${BASE_URL}${prefix}/passport/${slug}` },
    {
      name: summary.name,
      url: `${BASE_URL}${prefix}/passport/${slug}`,
    },
  ]);

  return (
    <>
      <script {...jsonLdScriptProps(breadcrumb, nonce)} />
      <Navbar />

      <main className="min-h-screen bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            <span aria-hidden="true">{summary.flag}</span>{" "}
            {t("h1", { country: summary.name })}
          </h1>

          {/* The headline number. visa-free + visa-on-arrival only: an eTA or
              e-visa still has to be applied for before you board, so counting
              them here would overstate what the passport actually does. */}
          <p className="mt-4 text-lg text-slate-700 max-w-2xl">
            {t.rich("lede", {
              country: summary.name,
              count: summary.noAdvancePaperwork,
              total: summary.total,
              strong: (c) => <strong className="font-semibold text-slate-900">{c}</strong>,
            })}
          </p>

          <PassportMap
            statusByIso2={summary.statusByIso2}
            homeIso2={summary.code}
            title={t("mapTitle", { country: summary.name })}
            caption={t("mapCaption", { country: summary.name })}
            labels={Object.fromEntries(
              Object.entries(LABEL_KEYS).map(([status, key]) => [
                status,
                t(`status.${key}.label`),
              ]),
            )}
          />

          <PassportStatusChart
            counts={summary.counts}
            total={summary.total}
            labels={Object.fromEntries(
              Object.entries(LABEL_KEYS).map(([status, key]) => [
                status,
                t(`status.${key}.label`),
              ]),
            )}
          />

          {/* Grouped destination lists, least paperwork first. */}
          <div className="mt-12 space-y-10">
            {summary.groups.map((group) => {
              const key = LABEL_KEYS[group.status];
              return (
                <section key={group.status}>
                  <h2 className="text-xl font-semibold text-slate-900">
                    {t(`status.${key}.label`)}{" "}
                    <span className="text-slate-400 font-normal tabular-nums">
                      ({group.destinations.length})
                    </span>
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 max-w-2xl">
                    {t(`status.${key}.blurb`)}
                  </p>
                  <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                    {group.destinations.map((d) => (
                      <li
                        key={d.iso2}
                        className="flex items-baseline gap-2 text-sm text-slate-800 border-b border-slate-100 py-1.5"
                      >
                        <span aria-hidden="true">{d.flag}</span>
                        <span className="flex-1">{d.name}</span>
                        {typeof d.days === "number" && (
                          <span className="text-slate-500 tabular-nums text-xs">
                            {t("days", { days: d.days })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          {/* Conversion path: the reader now knows where they can go, so the
              next question is what to do there. /trips/new prefills. */}
          <div className="mt-14 rounded-2xl bg-slate-50 border border-slate-200 p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-slate-900">{t("cta.heading")}</h2>
            <p className="mt-2 text-slate-700">{t("cta.body")}</p>
            <Link
              href="/trips/new"
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-[var(--primary)] px-6 py-3 font-semibold text-white hover:opacity-90 transition"
            >
              {t("cta.button")}
            </Link>
          </div>

          {/* Provenance. Visa rules change without notice and this dataset is a
              planning aid, not legal advice — the same disclaimer
              lib/visa/lookup.ts carries, surfaced where the reader is. */}
          <section className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-600">
            <h2 className="font-semibold text-slate-800">{t("sources.heading")}</h2>
            <p className="mt-2 max-w-3xl">{t("sources.body")}</p>
            <p className="mt-2">
              <Link href="/tools/visa-checker" className="text-[var(--primary)] underline">
                {t("sources.checkerLink")}
              </Link>
            </p>
          </section>

          {/* Sibling passports — internal links, and genuinely useful if the
              reader holds more than one. */}
          <nav aria-label={t("others")} className="mt-10 border-t border-slate-200 pt-6">
            <h2 className="text-sm font-semibold text-slate-800">{t("others")}</h2>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {PASSPORT_PAGE_CODES.filter((c) => c !== code).map((c) => {
                const other = getPassportSummary(c, locale);
                if (!other) return null;
                return (
                  <li key={c}>
                    <Link
                      href={`/passport/${passportSlug(c)}`}
                      className="text-[var(--primary)] hover:underline"
                    >
                      <span aria-hidden="true">{other.flag}</span> {other.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </main>

      <Footer />
    </>
  );
}
