import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/lib/i18n/routing';
import {
  generateFAQSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from '@/lib/seo/structured-data';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

const BASE_URL = 'https://monkeytravel.app';
const PAGE_PATH = '/group-trip-planner';

const META: Record<string, { title: string; description: string }> = {
  en: {
    title: 'AI Group Trip Planner — Plan Together, Vote, Decide | MonkeyTravel',
    description:
      'The only AI trip planner built for groups. Generate itineraries, invite friends, vote on activities, and reach consensus — all in one place. Free.',
  },
  es: {
    title:
      'Planificador AI para Viajes en Grupo — Planifica, Vota, Decide | MonkeyTravel',
    description:
      'El único planificador AI para grupos. Genera itinerarios, invita amigos, vota actividades y decide en grupo — todo en un lugar. Gratis.',
  },
  it: {
    title:
      'Pianificatore AI per Viaggi di Gruppo — Pianifica, Vota, Decidi | MonkeyTravel',
    description:
      'L\'unico pianificatore AI per gruppi. Genera itinerari, invita amici, vota le attività e decidi insieme — tutto in un posto. Gratuito.',
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const meta = META[locale] || META.en;
  const prefix = locale === 'en' ? '' : `/${locale}`;

  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: `${BASE_URL}${prefix}${PAGE_PATH}`,
      languages: {
        en: `${BASE_URL}${PAGE_PATH}`,
        es: `${BASE_URL}/es${PAGE_PATH}`,
        it: `${BASE_URL}/it${PAGE_PATH}`,
        'x-default': `${BASE_URL}${PAGE_PATH}`,
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: 'website',
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: 'MonkeyTravel — AI Group Trip Planner',
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

const PROBLEM_KEYS = ['chaos', 'opinions', 'money'] as const;
const PROBLEM_ICONS = [
  // Chaos
  <svg key="chaos" xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  // Opinions
  <svg key="opinions" xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  // Money
  <svg key="money" xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
];

const FEATURE_KEYS = [
  'aiItineraries',
  'voting',
  'proposals',
  'roles',
  'invite',
  'multilingual',
] as const;

const FEATURE_ICONS = [
  // AI Itineraries
  <svg key="ai" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
  // Voting
  <svg key="vote" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  // Proposals
  <svg key="propose" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>,
  // Roles
  <svg key="roles" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  // Invite
  <svg key="invite" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>,
  // Multilingual
  <svg key="lang" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>,
];

const STEP_KEYS = ['step1', 'step2', 'step3'] as const;
const TRIP_TYPE_KEYS = ['friends', 'bachelorette', 'family', 'corporate'] as const;
const TRIP_TYPE_ICONS = [
  // Friends
  <svg key="friends" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  // Bachelorette
  <svg key="bach" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>,
  // Family
  <svg key="family" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  // Corporate
  <svg key="corp" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
];

const FAQ_KEYS = [
  'howManyPeople',
  'needAccount',
  'votingWorks',
  'differentBudgets',
  'isFree',
  'splitCosts',
] as const;

// Related blog slugs for the group trip planner page
const RELATED_BLOG_SLUGS = [
  'how-to-plan-a-group-trip',
  'group-trip-budget-how-to-split-costs',
  'best-group-trip-destinations-2026',
  'group-travel-mistakes-to-avoid',
];

export default async function GroupTripPlannerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('groupTripPlanner');
  const tBlog = await getTranslations('blog');
  const prefix = locale === 'en' ? '' : `/${locale}`;

  // Build FAQ data
  const faqItems = FAQ_KEYS.map((key) => ({
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));

  // Build breadcrumb data
  const breadcrumbItems = [
    { name: t('breadcrumbs.home'), url: `${BASE_URL}${prefix}` },
    {
      name: t('breadcrumbs.groupTripPlanner'),
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
    },
  ];

  return (
    <>
      <script
        {...jsonLdScriptProps([
          generateFAQSchema(faqItems),
          generateBreadcrumbSchema(breadcrumbItems),
        ])}
      />

      <Navbar />

      <main className="min-h-screen">
        {/* ================================================================
            HERO SECTION
            ================================================================ */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[var(--primary)] via-[#0a5a8a] to-[#064060] text-white">
          <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[var(--accent)]/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-white/5 blur-3xl" />

          <div className="relative mx-auto max-w-4xl px-4 pb-16 pt-32 text-center sm:px-6 lg:px-8">
            <span className="mb-6 inline-block rounded-full bg-[var(--accent)]/20 px-4 py-1.5 text-sm font-medium text-[var(--accent)]">
              {t('hero.badge')}
            </span>

            <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              {t('hero.title')}
            </h1>

            <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-white/80 sm:text-xl">
              {t('hero.subtitle')}
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/trips/new"
                className="inline-flex items-center rounded-xl bg-[var(--accent)] px-8 py-4 text-base font-bold text-[#1a1a2e] shadow-lg transition hover:brightness-110"
              >
                {t('hero.cta')}
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center rounded-xl border border-white/30 px-6 py-3.5 text-base font-medium text-white transition hover:bg-white/10"
              >
                {t('hero.secondaryCta')}
              </a>
            </div>
          </div>
        </section>

        {/* ================================================================
            PROBLEM SECTION
            ================================================================ */}
        <section className="py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="mb-14 text-center">
              <h2 className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl">
                {t('problem.title')}
              </h2>
              <p className="text-lg text-gray-600">
                {t('problem.subtitle')}
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {PROBLEM_KEYS.map((key, i) => (
                <div
                  key={key}
                  className="rounded-2xl border border-red-100 bg-red-50/50 p-6 text-center"
                >
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-500">
                    {PROBLEM_ICONS[i]}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">
                    {t(`problem.items.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-600">
                    {t(`problem.items.${key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            FEATURES GRID
            ================================================================ */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="mb-14 text-center">
              <h2 className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl">
                {t('features.title')}
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-gray-600">
                {t('features.subtitle')}
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURE_KEYS.map((key, i) => (
                <div
                  key={key}
                  className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition hover:shadow-md"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)]">
                    {FEATURE_ICONS[i]}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">
                    {t(`features.items.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-600">
                    {t(`features.items.${key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            HOW IT WORKS
            ================================================================ */}
        <section id="how-it-works" className="py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-14 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {t('howItWorks.title')}
            </h2>

            <div className="grid gap-10 md:grid-cols-3">
              {STEP_KEYS.map((key, i) => (
                <div key={key} className="text-center">
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)] text-xl font-bold text-white">
                    {i + 1}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">
                    {t(`howItWorks.steps.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-600">
                    {t(`howItWorks.steps.${key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            TRIP TYPES
            ================================================================ */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {t('tripTypes.title')}
            </h2>

            <div className="grid gap-6 sm:grid-cols-2">
              {TRIP_TYPE_KEYS.map((key, i) => (
                <div
                  key={key}
                  className="flex gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                    {TRIP_TYPE_ICONS[i]}
                  </div>
                  <div>
                    <h3 className="mb-1 text-lg font-semibold text-gray-900">
                      {t(`tripTypes.items.${key}.title`)}
                    </h3>
                    <p className="text-sm leading-relaxed text-gray-600">
                      {t(`tripTypes.items.${key}.description`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            RELATED BLOG POSTS
            ================================================================ */}
        <section className="py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <h2 className="mb-3 text-3xl font-bold text-gray-900 sm:text-4xl">
                {t('blogPosts.title')}
              </h2>
              <p className="text-lg text-gray-600">
                {t('blogPosts.subtitle')}
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              {RELATED_BLOG_SLUGS.map((slug) => (
                <Link
                  key={slug}
                  href={`/blog/${slug}`}
                  className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition hover:border-[var(--primary)]/20 hover:shadow-md"
                >
                  <h3 className="mb-2 text-base font-semibold text-gray-900 transition group-hover:text-[var(--primary)]">
                    {tBlog(`posts.${slug}.title`)}
                  </h3>
                  <p className="mb-3 text-sm leading-relaxed text-gray-600">
                    {tBlog(`posts.${slug}.description`)}
                  </p>
                  <span className="text-sm font-medium text-[var(--primary)]">
                    {t('blogPosts.readMore')} &rarr;
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            FAQ
            ================================================================ */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-10 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {t('faq.title')}
            </h2>

            <div className="space-y-4">
              {FAQ_KEYS.map((key) => (
                <details
                  key={key}
                  className="group rounded-xl border border-gray-200 bg-white"
                >
                  <summary className="cursor-pointer list-none px-6 py-5 text-base font-medium text-gray-900 transition hover:text-[var(--primary)] [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between">
                      {t(`faq.items.${key}.question`)}
                      <svg
                        className="ml-4 h-5 w-5 shrink-0 text-gray-400 transition group-open:rotate-180"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </summary>
                  <div className="px-6 pb-5 text-sm leading-relaxed text-gray-600">
                    {t(`faq.items.${key}.answer`)}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            CTA
            ================================================================ */}
        <section className="bg-[#0f172a] py-20 text-white">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              {t('cta.title')}
            </h2>
            <p className="mb-8 text-lg text-white/70">
              {t('cta.subtitle')}
            </p>
            <Link
              href="/trips/new"
              className="inline-flex items-center rounded-xl bg-[var(--accent)] px-8 py-4 text-base font-bold text-[#1a1a2e] shadow-lg transition hover:brightness-110"
            >
              {t('cta.button')}
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
