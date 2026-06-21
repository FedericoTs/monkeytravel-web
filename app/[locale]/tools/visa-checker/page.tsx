import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "@/lib/i18n/routing";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import {
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";
import { lookupVisaRequirement, getDatasetSize } from "@/lib/visa/lookup";
import { getCountryOptions, getCountryName, iso2ToFlag } from "@/lib/visa/countries";
import { buildIvisaAffiliateUrl, shouldShowIvisaCta } from "@/lib/visa/ivisa";
import { fetchGovukAdvisory } from "@/lib/visa/govuk-advisory";
import VisaCheckerForm from "./VisaCheckerForm";
import ExternalLinkButton from "@/components/tools/ExternalLinkButton";
import VisaCheckerSsrTracker from "./VisaCheckerSsrTracker";

const BASE_URL = "https://monkeytravel.app";

const META: Record<string, { title: string; description: string }> = {
  pt: {
    title: "Verificador de Requisitos de Visto — Grátis, 199 Passaportes",
    description:
      "Descubra em segundos se você precisa de visto para a próxima viagem. Grátis, sem cadastro. 199 passaportes × 199 destinos com os dados abertos mais recentes.",
  },
  en: {
    title: "Visa Requirements Checker — Free, Covers 199 Passports",
    description:
      "Find out in seconds whether you need a visa for your next trip. Free, no signup. Covers 199 passports × 199 destinations with the latest open data.",
  },
  it: {
    title: "Verifica Requisiti Visto — Gratis, 199 Passaporti",
    description:
      "Scopri in pochi secondi se ti serve un visto per il tuo prossimo viaggio. Gratis, senza registrazione. 199 passaporti × 199 destinazioni.",
  },
  es: {
    title: "Verificador de Requisitos de Visa — Gratis, 199 Pasaportes",
    description:
      "Descubre en segundos si necesitas visa para tu próximo viaje. Gratis, sin registro. 199 pasaportes × 199 destinos con los últimos datos abiertos.",
  },
};

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const sp = await searchParams;
  const m = META[locale] || META.en;
  const localePrefix = locale === "en" ? "" : `/${locale}`;
  const canonical = `${BASE_URL}${localePrefix}/tools/visa-checker`;

  // When the user has selected a specific pair, surface it in OG +
  // description so the social card is meaningful when shared.
  let title = m.title;
  let description = m.description;
  if (sp?.from && sp?.to) {
    const fromName = getCountryName(sp.from, locale);
    const toName = getCountryName(sp.to, locale);
    if (locale === "it") {
      title = `${fromName} → ${toName}: serve il visto? · monkeytravel`;
      description = `Verifica gratuita dei requisiti visto per andare da ${fromName} a ${toName}.`;
    } else if (locale === "es") {
      title = `${fromName} → ${toName}: ¿se necesita visa? · monkeytravel`;
      description = `Verificación gratuita de requisitos de visa de ${fromName} a ${toName}.`;
    } else {
      title = `${fromName} → ${toName}: do you need a visa? · monkeytravel`;
      description = `Free visa-requirement check for travel from ${fromName} to ${toName}.`;
    }
  }

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        en: `${BASE_URL}/tools/visa-checker`,
        it: `${BASE_URL}/it/tools/visa-checker`,
        es: `${BASE_URL}/es/tools/visa-checker`,
        pt: `${BASE_URL}/pt/tools/visa-checker`,
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
    },
  };
}

export default async function VisaCheckerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("tools.visaChecker");
  const tToolsLanding = await getTranslations("tools.landing");
  // Day-7 fix: namespace path is `common.breadcrumbs`, NOT `breadcrumbs` —
  // the root i18n config only loads top-level files (common.json, auth.json,
  // ...) so calling getTranslations("breadcrumbs") finds nothing and
  // next-intl renders the literal "breadcrumbs.home" key. Fixed by using
  // the full path. Same pattern would bite any future breadcrumb caller.
  const tBreadcrumbs = await getTranslations("common.breadcrumbs");

  const localePrefix = locale === "en" ? "" : `/${locale}`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: tBreadcrumbs("home"), url: BASE_URL },
    { name: tToolsLanding("breadcrumb"), url: `${BASE_URL}${localePrefix}/tools` },
    {
      name: t("breadcrumb"),
      url: `${BASE_URL}${localePrefix}/tools/visa-checker`,
    },
  ]);

  const countryOptions = getCountryOptions(locale);
  const datasetSize = getDatasetSize();

  // Server-side lookup so the result is in the initial HTML —
  // great for SEO on long-tail country pairs and shareable URLs.
  const from = (sp?.from || "").toUpperCase();
  const to = (sp?.to || "").toUpperCase();
  const hasQuery = from.length === 2 && to.length === 2;
  const result = hasQuery ? lookupVisaRequirement(from, to) : null;

  // Fetch the GOV.UK advisory in parallel with rendering. Never blocks
  // the page — fetchGovukAdvisory returns null on any failure.
  const advisory = hasQuery && result ? await fetchGovukAdvisory(to) : null;

  const fromName = hasQuery ? getCountryName(from, locale) : "";
  const toName = hasQuery ? getCountryName(to, locale) : "";
  const fromFlag = hasQuery ? iso2ToFlag(from) : "";
  const toFlag = hasQuery ? iso2ToFlag(to) : "";

  const status = result?.status;
  const days = result?.days;

  // Pick the right translation key — "<status> days" if we have a
  // day count, otherwise the bare status. Falls back to "visa required"
  // if the status union ever drifts.
  const statusKey =
    status &&
    days &&
    ["visa free", "visa on arrival", "eta", "e-visa"].includes(status)
      ? `${status} days`
      : status || "";

  const showIvisa = status ? shouldShowIvisaCta(status) : false;
  const ivisaUrl = showIvisa ? buildIvisaAffiliateUrl(to, from) : null;

  // Official source — when no GOV.UK advisory exists, fall back to an
  // embassy search on Google. When an advisory IS present we hide this
  // card entirely (see render below): the advisory card already cites
  // the same GOV.UK page, so showing both creates two CTAs pointing at
  // the identical URL — Day-4 bug #7. Hand-curated official URLs are a
  // Phase B refinement.
  const hasOfficialSource = !advisory; // when advisory exists it IS the official source
  const officialSourceUrl = hasOfficialSource
    ? `https://www.google.com/search?q=${encodeURIComponent(
        `${toName} visa requirements for ${fromName} passport site:gov`
      )}`
    : null;

  // Today as ISO date for the "data refreshed" credit.
  const refreshedDate = new Date().toISOString().split("T")[0];

  const nonce = await getNonce();

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />
      {/* Day-4 bug fix #10: when the SSR result renders for a shared
          ?from=XX&to=YY link, the form's onSubmit never fires, so the
          tools_visa_checker_query event was missing the shared-link
          cohort entirely. This tiny client tracker fires it once on
          mount when the page rendered with a query. */}
      {hasQuery && (
        <VisaCheckerSsrTracker
          from={from}
          to={to}
          locale={locale}
          hasResult={!!result}
        />
      )}
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 sm:py-12 w-full">
        <nav className="text-sm text-slate-500 mb-4" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-slate-700">
            {tBreadcrumbs("home")}
          </Link>
          <span className="mx-2">/</span>
          <Link href="/tools" className="hover:text-slate-700">
            {tToolsLanding("breadcrumb")}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{t("breadcrumb")}</span>
        </nav>

        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 tracking-tight">
          {t("h1")}
        </h1>
        <p className="text-lg text-slate-600 mb-6">{t("subtitle")}</p>

        <VisaCheckerForm
          locale={locale}
          options={countryOptions}
          defaultFrom={from}
          defaultTo={to}
        />

        {hasQuery && !result && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-amber-900 font-medium">
              {t("noResultTitle")}
            </p>
            <p className="text-amber-900/80 text-sm mt-1">
              {t("noResultSubtitle")}
            </p>
          </div>
        )}

        {hasQuery && result && (
          <section className="mt-8 space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-3 text-2xl mb-3">
                <span aria-hidden>{fromFlag}</span>
                <span className="text-slate-400 text-base">→</span>
                <span aria-hidden>{toFlag}</span>
              </div>
              <p className="text-sm text-slate-500 mb-2">
                {t("resultIntro", {
                  passport: fromName,
                  destination: toName,
                })}
              </p>
              <p className="text-2xl sm:text-3xl font-semibold text-slate-900 mb-3">
                {(() => {
                  // next-intl is strict about which keys accept placeholders.
                  // "<status> days" variants take {days}; the bare statuses
                  // don't. Branch so we pass values only when expected.
                  // **2026-05-25 fix**: the lookup key needs the "status."
                  // prefix — without it we get the raw key path rendered
                  // (e.g. "tools.visaChecker.eta days") instead of the
                  // localized label.
                  const key = `status.${statusKey || "visa required"}`;
                  if (key.endsWith(" days") && typeof days === "number") {
                    return t(key as never, { days } as never);
                  }
                  return t(key as never);
                })()}
              </p>
              {status && status !== "same country" && (
                <p className="text-slate-700 leading-relaxed">
                  {t(`statusExplain.${status}` as never)}
                </p>
              )}
            </div>

            {/* Day-4 bug fix #7: hide the "Official source" card when a
                GOV.UK advisory is present, because the advisory card
                below cites the same URL. Both CTAs pointing at the
                identical URL was confusing users and inflating clicks. */}
            {status !== "same country" && officialSourceUrl && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="mb-2">{t("officialSourcePrefix")}</p>
                <ExternalLinkButton
                  href={officialSourceUrl}
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-2 font-medium text-[var(--primary)] hover:underline"
                  captureEvent="tools_visa_checker_external_click"
                  captureProps={{
                    kind: "official",
                    from,
                    to,
                    locale,
                  }}
                >
                  🔗 {t("officialSource")}
                </ExternalLinkButton>
              </div>
            )}

            {advisory && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-2 uppercase tracking-wide">
                  {t("advisoryTitle")}
                </h2>
                {/*
                  2026-05-31 P2 i18n fix: the FCDO API returns advisory.summary
                  in English only ("FCDO travel advice for X. Includes safety
                  and security, insurance, entry requirements and legal
                  differences."). Showing that raw on /it /es leaked English
                  into the localized page. The summary is a fixed boilerplate
                  pattern keyed on the country name, so we render the
                  localized boilerplate ourselves and only fall back to the
                  raw API summary if it diverges from the known pattern.
                */}
                <p className="text-slate-700 leading-relaxed mb-3">
                  {t("advisorySummary", { country: toName })}
                </p>
                <ExternalLinkButton
                  href={advisory.url}
                  rel="noopener noreferrer nofollow"
                  className="text-sm text-[var(--primary)] hover:underline"
                  captureEvent="tools_visa_checker_external_click"
                  captureProps={{
                    kind: "advisory",
                    from,
                    to,
                    locale,
                  }}
                >
                  {t("advisoryUkSource")} →
                </ExternalLinkButton>
              </div>
            )}

            {showIvisa && ivisaUrl && (
              <ExternalLinkButton
                href={ivisaUrl}
                rel="noopener sponsored nofollow"
                className="block w-full text-left rounded-2xl border border-emerald-300 bg-emerald-50 p-5 hover:bg-emerald-100 transition"
                captureEvent="tools_visa_checker_external_click"
                captureProps={{
                  kind: "ivisa",
                  from,
                  to,
                  locale,
                  partner: "ivisa",
                }}
              >
                <p className="font-semibold text-emerald-900">
                  {t("ivisaCta", { destination: toName })}
                </p>
                <p className="text-sm text-emerald-800 mt-1">
                  {t("ivisaSubtext")}
                </p>
              </ExternalLinkButton>
            )}

            {/* CTA to the full trip planner — convert tool users into
                wizard users. Pre-fills the destination country. */}
            {status !== "same country" && status !== "no admission" && (
              <Link
                href={`/trips/new?destination=${encodeURIComponent(toName)}`}
                className="inline-flex items-center gap-2 text-[var(--primary)] hover:underline font-medium"
              >
                {t("planTripCta", { destination: toName })}
              </Link>
            )}

            <p className="text-xs text-slate-500 border-t border-slate-200 pt-4 leading-relaxed">
              {t("disclaimer")}
            </p>
            <p className="text-xs text-slate-400">
              {t("datasetCredit", { date: refreshedDate })} ·{" "}
              {datasetSize.passports}×{datasetSize.destinations} ={" "}
              {datasetSize.pairs.toLocaleString(locale)} pairs
            </p>
          </section>
        )}

        {!hasQuery && (
          <div className="mt-6 text-sm text-slate-500">
            {t("datasetCredit", { date: refreshedDate })} ·{" "}
            {datasetSize.pairs.toLocaleString(locale)} pairs
          </div>
        )}

        <div className="border-t border-slate-200 mt-12 pt-8">
          <Link
            href="/tools/packing-list"
            className="inline-flex items-center gap-2 text-[var(--primary)] hover:underline font-medium"
          >
            🧳{" "}
            {locale === "it"
              ? "Prova anche il Generatore Lista Bagaglio"
              : locale === "es"
                ? "Prueba también el Generador de Lista de Equipaje"
                : "Try the Packing List Generator next"}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
