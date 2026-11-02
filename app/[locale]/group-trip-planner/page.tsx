import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import LiveStats from '@/components/stats/LiveStats';
import { Link } from '@/lib/i18n/routing';
import {
  generateFAQSchema,
  generateBreadcrumbSchema,
  generateWebPageSchema,
  jsonLdScriptProps,
} from '@/lib/seo/structured-data';
import LastUpdated from '@/components/seo/LastUpdated';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import LandingWhatIs from '@/components/landing/LandingWhatIs';
import LandingFeatures, { type LandingFeature } from '@/components/landing/LandingFeatures';
import LandingHowItWorks from '@/components/landing/LandingHowItWorks';
import LandingFaq from '@/components/landing/LandingFaq';
import LandingHero from '@/components/landing/LandingHero';
import LandingFinalCta from '@/components/landing/LandingFinalCta';

const BASE_URL = 'https://monkeytravel.app';
/**
 * Content freshness signal. Bump ONLY when this page's copy actually
 * changes — never automate it. A date that moves on every build tells Google
 * the whole site churns and teaches it to discount lastmod everywhere.
 */
const CONTENT_UPDATED = '2026-08-21';
const PAGE_PATH = '/group-trip-planner';

const META: Record<string, { title: string; description: string }> = {
  pt: {
    title: 'Planejador de Viagens em Grupo com AI — Vote e Decida',
    description:
      'O único planejador de viagens com AI feito para grupos. Gere roteiros, convide amigos, votem nas atividades e decidam juntos — tudo em um só lugar. Grátis.',
  },
  en: {
    title: 'AI Group Trip Planner — Plan Together, Vote, Decide',
    description:
      'The only AI trip planner built for groups. Generate itineraries, invite friends, vote on activities, and reach consensus — all in one place. Free.',
  },
  es: {
    title:
      'Planificador AI para Viajes en Grupo — Vota y Decide',
    description:
      'El único planificador AI para grupos. Genera itinerarios, invita amigos, vota actividades y decide en grupo — todo en un lugar. Gratis.',
  },
  it: {
    title:
      'Pianificatore AI per Viaggi di Gruppo — Vota e Decidi',
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
    // `absolute` opts out of the root "%s | MonkeyTravel" template.
    // These pages target generic commercial terms where the brand buys
    // nothing and costs 15 of ~60 rendered characters. Homepage keeps it.
    title: { absolute: meta.title },
    description: meta.description,
    alternates: {
      canonical: `${BASE_URL}${prefix}${PAGE_PATH}`,
      languages: {
        en: `${BASE_URL}${PAGE_PATH}`,
        es: `${BASE_URL}/es${PAGE_PATH}`,
        it: `${BASE_URL}/it${PAGE_PATH}`,
        pt: `${BASE_URL}/pt${PAGE_PATH}`,
        'x-default': `${BASE_URL}${PAGE_PATH}`,
      },
    },
    openGraph: {
      siteName: "MonkeyTravel",
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

const PROBLEM_CONFIGS = [
  {
    key: 'chaos',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    key: 'opinions',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'money',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

const FEATURES: LandingFeature[] = [
  {
    key: 'aiItineraries',
    color: 'bg-amber-50 text-amber-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    key: 'voting',
    color: 'bg-emerald-50 text-emerald-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'proposals',
    color: 'bg-blue-50 text-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
  {
    key: 'roles',
    color: 'bg-violet-50 text-violet-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    key: 'invite',
    color: 'bg-rose-50 text-rose-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
  },
  {
    key: 'multilingual',
    color: 'bg-cyan-50 text-cyan-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
      </svg>
    ),
  },
];

const STEP_CONFIGS = [
  {
    key: 'step1',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    key: 'step2',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    key: 'step3',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

const TRIP_TYPE_KEYS = ['friends', 'bachelorette', 'family', 'corporate'] as const;
const TRIP_TYPE_ICONS = [
  <svg key="friends" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  <svg key="bach" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>,
  <svg key="family" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  <svg key="corp" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
];

const FAQ_KEYS = [
  'howManyPeople',
  'needAccount',
  'votingWorks',
  'differentBudgets',
  'isFree',
  'splitCosts',
] as const;

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
          generateWebPageSchema({
            name: breadcrumbItems[breadcrumbItems.length - 1].name,
            url: breadcrumbItems[breadcrumbItems.length - 1].url,
            dateModified: CONTENT_UPDATED,
          }),
        ])}
      />

      <Navbar />

      <main className="min-h-screen">
        <LandingHero namespace="groupTripPlanner" />

        <LandingWhatIs namespace="groupTripPlanner" />

        <LiveStats locale={locale} focus="group" />

        {/* ================================================================
            PROBLEM SECTION
            ================================================================ */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('problem.title')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                {t('problem.subtitle')}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {PROBLEM_CONFIGS.map((item) => (
                <div
                  key={item.key}
                  className="text-center p-8 rounded-2xl bg-[var(--background-alt)] border border-gray-100"
                >
                  <div className="w-14 h-14 rounded-2xl bg-red-50 text-[var(--error)] flex items-center justify-center mx-auto mb-5">
                    {item.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">
                    {t(`problem.items.${item.key}.title`)}
                  </h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed">
                    {t(`problem.items.${item.key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <LandingFeatures namespace="groupTripPlanner" features={FEATURES} />

        <LandingHowItWorks namespace="groupTripPlanner" steps={STEP_CONFIGS} />

        {/* ================================================================
            TRIP TYPES
            ================================================================ */}
        <section className="py-20 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="mb-12 text-center text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] tracking-tight">
              {t('tripTypes.title')}
            </h2>

            <div className="grid gap-6 sm:grid-cols-2">
              {TRIP_TYPE_KEYS.map((key, i) => (
                <div
                  key={key}
                  className="group flex gap-4 rounded-3xl border border-gray-100 bg-[var(--background-alt)] p-6 card-hover"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] group-hover:scale-110 transition-transform">
                    {TRIP_TYPE_ICONS[i]}
                  </div>
                  <div>
                    <h3 className="mb-1 text-lg font-semibold text-[var(--foreground)]">
                      {t(`tripTypes.items.${key}.title`)}
                    </h3>
                    <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
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
        <section className="py-20 bg-[var(--background-alt)]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <h2 className="mb-3 text-3xl sm:text-4xl font-bold text-[var(--foreground)] tracking-tight">
                {t('blogPosts.title')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)]">
                {t('blogPosts.subtitle')}
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              {RELATED_BLOG_SLUGS.map((slug) => (
                <Link
                  key={slug}
                  href={`/blog/${slug}`}
                  className="group rounded-3xl border border-gray-100 bg-white p-6 shadow-sm card-hover"
                >
                  <h3 className="mb-2 text-base font-semibold text-[var(--foreground)] transition group-hover:text-[var(--primary-ink)]">
                    {tBlog(`posts.${slug}.title`)}
                  </h3>
                  <p className="mb-3 text-sm leading-relaxed text-[var(--foreground-muted)]">
                    {tBlog(`posts.${slug}.description`)}
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary-ink)]">
                    {t('blogPosts.readMore')}
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <LandingFaq title={t('faq.title')} items={faqItems} surface="white" />

        <LandingFinalCta namespace="groupTripPlanner" subscribeSource="group-trip-planner-cta" surface="alt" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10 text-center">
          <LastUpdated date={CONTENT_UPDATED} />
        </div>
      </main>

      <Footer />
    </>
  );
}
