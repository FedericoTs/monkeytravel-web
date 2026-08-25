import { notFound } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import HeroDoodleBackground from '@/components/marketing/HeroDoodleBackground';
import { HERO_DOODLE_ENABLED } from '@/components/marketing/doodle';
import { Link, routing } from '@/lib/i18n/routing';
import {
  generateFAQSchema,
  generateBreadcrumbSchema,
  generateWebPageSchema,
  jsonLdScriptProps,
} from '@/lib/seo/structured-data';
import LastUpdated from '@/components/seo/LastUpdated';
import { getNonce } from '@/lib/security/nonce';
import { setRequestLocale } from 'next-intl/server';
import {
  COMPETITORS,
  getCompetitor,
  type Cell,
  type CompareLocale,
} from '@/lib/comparison/competitors';
import type { Metadata } from 'next';

const BASE_URL = 'https://monkeytravel.app';
/**
 * Content freshness signal. Bump ONLY when this page's copy actually
 * changes — never automate it. A date that moves on every build tells Google
 * the whole site churns and teaches it to discount lastmod everywhere.
 */
const CONTENT_UPDATED = '2026-08-18';

/**
 * "<competitor> alternative" comparison pages.
 *
 * Targets bottom-funnel branded search ("wanderlog alternative"), which is the
 * one SERP class where a young domain can outrank an incumbent: the incumbent
 * does not write the page, so the competition is other small sites rather than
 * the brand itself.
 *
 * All copy lives in lib/comparison/competitors.ts. This file is only layout —
 * adding a competitor must never mean touching this file.
 *
 * Editorial stance is deliberate: every page states plainly where the
 * competitor is better. That is not modesty, it is what makes the rest of the
 * page believable, and it is the difference between a comparison and an advert.
 */

const LOCALES: CompareLocale[] = ['en', 'es', 'it', 'pt'];

function asCompareLocale(locale: string): CompareLocale {
  return (LOCALES as string[]).includes(locale)
    ? (locale as CompareLocale)
    : 'en';
}

/** Pre-render locale × competitor at build time. */
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    COMPETITORS.map((c) => ({ locale, competitor: c.slug }))
  );
}

const UI: Record<
  CompareLocale,
  {
    tableUs: string;
    tableThem: string;
    yes: string;
    no: string;
    theyWinTitle: string;
    weWinTitle: string;
    faqTitle: string;
    ctaTitle: string;
    ctaSub: string;
    ctaButton: string;
    verifiedPrefix: string;
    verifiedSuffix: string;
    breadcrumbCompare: string;
    home: string;
  }
> = {
  en: {
    tableUs: 'MonkeyTravel',
    tableThem: '',
    yes: 'Yes',
    no: 'No',
    theyWinTitle: 'Where {name} is the better choice',
    weWinTitle: 'Where MonkeyTravel is the better choice',
    faqTitle: 'Common questions',
    ctaTitle: 'See it for yourself',
    ctaSub: 'Build a full itinerary in a couple of minutes. No account needed.',
    ctaButton: 'Plan a trip free',
    verifiedPrefix: 'Comparison last verified',
    verifiedSuffix:
      '. Features change — if something here is out of date, tell us and we will correct it.',
    breadcrumbCompare: 'Compare',
    home: 'Home',
  },
  es: {
    tableUs: 'MonkeyTravel',
    tableThem: '',
    yes: 'Sí',
    no: 'No',
    theyWinTitle: 'Dónde {name} es la mejor opción',
    weWinTitle: 'Dónde MonkeyTravel es la mejor opción',
    faqTitle: 'Preguntas frecuentes',
    ctaTitle: 'Compruébalo tú mismo',
    ctaSub: 'Crea un itinerario completo en un par de minutos. Sin cuenta.',
    ctaButton: 'Planifica un viaje gratis',
    verifiedPrefix: 'Comparativa verificada por última vez el',
    verifiedSuffix:
      '. Las funciones cambian — si algo aquí está desactualizado, dínoslo y lo corregimos.',
    breadcrumbCompare: 'Comparativas',
    home: 'Inicio',
  },
  it: {
    tableUs: 'MonkeyTravel',
    tableThem: '',
    yes: 'Sì',
    no: 'No',
    theyWinTitle: 'Dove {name} è la scelta migliore',
    weWinTitle: 'Dove MonkeyTravel è la scelta migliore',
    faqTitle: 'Domande frequenti',
    ctaTitle: 'Provalo tu stesso',
    ctaSub: 'Crea un itinerario completo in un paio di minuti. Senza account.',
    ctaButton: 'Pianifica un viaggio gratis',
    verifiedPrefix: 'Confronto verificato l’ultima volta il',
    verifiedSuffix:
      '. Le funzioni cambiano — se qualcosa qui non è aggiornato, segnalacelo e lo correggiamo.',
    breadcrumbCompare: 'Confronti',
    home: 'Home',
  },
  pt: {
    tableUs: 'MonkeyTravel',
    tableThem: '',
    yes: 'Sim',
    no: 'Não',
    theyWinTitle: 'Onde o {name} é a melhor escolha',
    weWinTitle: 'Onde o MonkeyTravel é a melhor escolha',
    faqTitle: 'Perguntas frequentes',
    ctaTitle: 'Veja você mesmo',
    ctaSub: 'Monte um roteiro completo em poucos minutos. Sem conta.',
    ctaButton: 'Planeje uma viagem grátis',
    verifiedPrefix: 'Comparativo verificado pela última vez em',
    verifiedSuffix:
      '. Os recursos mudam — se algo aqui estiver desatualizado, avise-nos e corrigiremos.',
    breadcrumbCompare: 'Comparativos',
    home: 'Início',
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; competitor: string }>;
}): Promise<Metadata> {
  const { locale, competitor } = await params;
  const c = getCompetitor(competitor);
  if (!c) return {};

  const l = asCompareLocale(locale);
  const meta = c.meta[l];
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const path = `/compare/${c.slug}`;

  return {
    // `absolute` opts out of the root "%s | MonkeyTravel" template.
    // These pages target generic commercial terms where the brand buys
    // nothing and costs 15 of ~60 rendered characters. Homepage keeps it.
    title: { absolute: meta.title },
    description: meta.description,
    alternates: {
      canonical: `${BASE_URL}${prefix}${path}`,
      languages: {
        en: `${BASE_URL}${path}`,
        es: `${BASE_URL}/es${path}`,
        it: `${BASE_URL}/it${path}`,
        pt: `${BASE_URL}/pt${path}`,
        'x-default': `${BASE_URL}${path}`,
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: 'website',
      url: `${BASE_URL}${prefix}${path}`,
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: `MonkeyTravel vs ${c.name}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      images: [`${BASE_URL}/og-image.png`],
    },
  };
}

function Tick({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${
        on ? 'text-emerald-700' : 'text-slate-400'
      }`}
    >
      <svg
        className="w-4 h-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        {on ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M5 13l4 4L19 7"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M6 18L18 6M6 6l12 12"
          />
        )}
      </svg>
      {label}
    </span>
  );
}

function CellValue({
  value,
  l,
  yes,
  no,
}: {
  value: Cell;
  l: CompareLocale;
  yes: string;
  no: string;
}) {
  if (typeof value === 'boolean') {
    return <Tick on={value} label={value ? yes : no} />;
  }
  return <span className="text-slate-700">{value[l]}</span>;
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string; competitor: string }>;
}) {
  const { locale, competitor } = await params;
  setRequestLocale(locale);

  const c = getCompetitor(competitor);
  if (!c) notFound();

  const l = asCompareLocale(locale);
  const ui = UI[l];
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const path = `/compare/${c.slug}`;
  const nonce = await getNonce();

  const faqItems = c.faqs[l].map((f) => ({ question: f.q, answer: f.a }));
  const breadcrumbItems = [
    { name: ui.home, url: `${BASE_URL}${prefix}` },
    { name: ui.breadcrumbCompare, url: `${BASE_URL}${prefix}/compare` },
    { name: `MonkeyTravel vs ${c.name}`, url: `${BASE_URL}${prefix}${path}` },
  ];

  const verifiedDate = new Intl.DateTimeFormat(l, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${c.researchedAt}T00:00:00Z`));

  return (
    <>
      <script
        {...jsonLdScriptProps(
          [
            generateFAQSchema(faqItems),
            generateBreadcrumbSchema(breadcrumbItems),
          generateWebPageSchema({
            name: breadcrumbItems[breadcrumbItems.length - 1].name,
            url: breadcrumbItems[breadcrumbItems.length - 1].url,
            dateModified: CONTENT_UPDATED,
          }),
          ],
          nonce
        )}
      />

      <Navbar />

      <main className="min-h-screen bg-white">
        {/* Hero.
            Mirrors the marketing landing pages: `hero-gradient` is what the
            [data-brand="doodle"] block in globals.css hooks onto, and the art
            layer swaps with the brand flag. Without this the page renders the
            pre-rebrand gradient while every other marketing page is inked. */}
        <section className="relative pt-28 pb-14 px-4 overflow-hidden hero-gradient">
          {HERO_DOODLE_ENABLED ? (
            <HeroDoodleBackground layout="centered" />
          ) : (
            <>
              <div className="absolute inset-0 bg-grid-pattern-light opacity-50" />
              <div className="absolute top-24 left-[10%] w-72 h-72 bg-[var(--accent)]/10 rounded-full blur-[100px] animate-pulse-glow" />
              <div className="absolute top-48 right-[5%] w-96 h-96 bg-[var(--primary)]/8 rounded-full blur-[120px] animate-pulse-glow" />
            </>
          )}

          <div className="relative max-w-4xl mx-auto text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--primary-ink)] mb-3">
              MonkeyTravel vs {c.name}
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[var(--foreground)] mb-5 leading-tight tracking-tight">
              {c.hero[l].h1}
            </h1>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
              {c.hero[l].sub}
            </p>
            <div className="mt-8">
              <Link
                href="/trips/new"
                className="inline-flex items-center justify-center px-7 py-3.5 rounded-xl bg-[var(--primary-ink)] text-white font-semibold shadow-sm hover:opacity-95 transition-opacity"
              >
                {ui.ctaButton}
              </Link>
            </div>
          </div>
        </section>

        {/* Honest verdict — who each product is for */}
        <section className="py-14 px-4">
          <div className="max-w-4xl mx-auto grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="font-semibold text-slate-900 mb-2">
                {c.name}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {c.verdict[l].themFor}
              </p>
            </div>
            <div className="rounded-2xl border-2 border-[var(--primary)]/25 bg-[var(--primary)]/[0.04] p-6">
              <h2 className="font-semibold text-slate-900 mb-2">MonkeyTravel</h2>
              <p className="text-slate-600 leading-relaxed">
                {c.verdict[l].usFor}
              </p>
            </div>
          </div>
        </section>

        {/* Feature table — scrolls inside its own container on small screens */}
        <section className="pb-14 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">
                  MonkeyTravel vs {c.name}
                </caption>
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="text-left font-semibold text-slate-500 px-5 py-3.5 w-[38%]">
                      &nbsp;
                    </th>
                    <th scope="col" className="text-left font-semibold text-slate-900 px-5 py-3.5">
                      {ui.tableUs}
                    </th>
                    <th scope="col" className="text-left font-semibold text-slate-900 px-5 py-3.5">
                      {c.name}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {c.rows.map((row, i) => (
                    <tr key={i} className="align-top">
                      <th
                        scope="row"
                        className="text-left font-medium text-slate-700 px-5 py-4"
                      >
                        {row.label[l]}
                      </th>
                      <td className="px-5 py-4">
                        <CellValue value={row.us} l={l} yes={ui.yes} no={ui.no} />
                      </td>
                      <td className="px-5 py-4">
                        <CellValue value={row.them} l={l} yes={ui.yes} no={ui.no} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              {ui.verifiedPrefix} {verifiedDate}
              {ui.verifiedSuffix}
            </p>
          </div>
        </section>

        {/* Where they win — first, deliberately */}
        <section className="py-14 px-4 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">
              {ui.theyWinTitle.replace('{name}', c.name)}
            </h2>
            <ul className="space-y-3">
              {c.theyWin[l].map((item, i) => (
                <li key={i} className="flex gap-3 text-slate-700 leading-relaxed">
                  <span
                    className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Where we win */}
        <section className="py-14 px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">
              {ui.weWinTitle}
            </h2>
            <ul className="space-y-3">
              {c.weWin[l].map((item, i) => (
                <li key={i} className="flex gap-3 text-slate-700 leading-relaxed">
                  <svg
                    className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-14 px-4 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">
              {ui.faqTitle}
            </h2>
            <div className="space-y-4">
              {c.faqs[l].map((f, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-white border border-slate-200 p-5"
                >
                  <h3 className="font-semibold text-slate-900 mb-1.5">{f.q}</h3>
                  <p className="text-slate-600 leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 px-4">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
              {ui.ctaTitle}
            </h2>
            <p className="text-slate-600 mb-7">{ui.ctaSub}</p>
            <Link
              href="/trips/new"
              className="inline-flex items-center justify-center px-8 py-4 rounded-xl bg-[var(--primary-ink)] text-white font-semibold shadow-sm hover:opacity-95 transition-opacity"
            >
              {ui.ctaButton}
            </Link>
          </div>
        </section>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 text-center">
          <LastUpdated date={CONTENT_UPDATED} />
        </div>
      </main>

      <Footer />
    </>
  );
}
