import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import EmailSubscribe from '@/components/EmailSubscribe';
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

const FEATURE_KEYS = [
  'aiItineraries',
  'voting',
  'proposals',
  'roles',
  'invite',
  'multilingual',
] as const;

const FEATURE_CONFIGS = [
  {
    color: 'bg-amber-50 text-amber-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    color: 'bg-emerald-50 text-emerald-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    color: 'bg-blue-50 text-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
  {
    color: 'bg-violet-50 text-violet-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    color: 'bg-rose-50 text-rose-500',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
  },
  {
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
        ])}
      />

      <Navbar />

      <main className="min-h-screen">
        {/* ================================================================
            HERO SECTION
            ================================================================ */}
        <section className="relative min-h-[80vh] pt-20 pb-16 overflow-hidden hero-gradient">
          {/* Grid overlay */}
          <div className="absolute inset-0 bg-grid-pattern-light opacity-50" />

          {/* Animated orbs */}
          <div className="absolute top-32 left-[10%] w-72 h-72 bg-[var(--accent)]/10 rounded-full blur-[100px] animate-pulse-glow" />
          <div className="absolute top-64 right-[5%] w-96 h-96 bg-[var(--primary)]/8 rounded-full blur-[120px] animate-pulse-glow" style={{ animationDelay: '2s' }} />

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-sm font-semibold text-emerald-700">
                {t('hero.badge')}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--foreground)] leading-[1.08] tracking-tight mb-6">
              {t('hero.title')}
            </h1>

            <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-10 max-w-2xl leading-relaxed">
              {t('hero.subtitle')}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link
                href="/trips/new"
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30"
              >
                <span>{t('hero.cta')}</span>
                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-gray-200 text-[var(--foreground)] font-semibold rounded-xl hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all"
              >
                {t('hero.secondaryCta')}
              </a>
            </div>

            {/* Trust Signals */}
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm text-[var(--foreground-muted)]">
              {(['free', 'noCard', 'instant'] as const).map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{t(`hero.trustSignals.${key}`)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            SOCIAL PROOF STATS BAR
            ================================================================ */}
        <section className="py-8 bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-16 text-center">
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">30s</div>
                <div className="text-sm text-[var(--foreground-muted)]">Idea to Itinerary</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">4</div>
                <div className="text-sm text-[var(--foreground-muted)]">Voting Levels</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">100%</div>
                <div className="text-sm text-[var(--foreground-muted)]">Free</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">8+</div>
                <div className="text-sm text-[var(--foreground-muted)]">Friends Per Trip</div>
              </div>
            </div>
          </div>
        </section>

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

        {/* ================================================================
            FEATURES GRID
            ================================================================ */}
        <section id="features" className="py-24 bg-white relative overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern-accent opacity-30" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/10 text-[var(--primary-dark)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                {t('features.title')}
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('features.title')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                {t('features.subtitle')}
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURE_KEYS.map((key, i) => (
                <div
                  key={key}
                  className="group relative p-8 rounded-3xl bg-[var(--background-alt)] border border-gray-100 card-hover"
                >
                  <div className={`w-14 h-14 rounded-2xl ${FEATURE_CONFIGS[i].color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                    {FEATURE_CONFIGS[i].icon}
                  </div>
                  <h3 className="text-xl font-semibold text-[var(--foreground)] mb-3">
                    {t(`features.items.${key}.title`)}
                  </h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed">
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
        <section id="how-it-works" className="py-24 bg-[var(--background-alt)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-semibold mb-6">
                {t('howItWorks.title')}
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('howItWorks.title')}
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {STEP_CONFIGS.map((item, index) => (
                <div key={item.key} className="relative text-center">
                  {/* Connector line */}
                  {index < 2 && (
                    <div className="hidden md:block absolute top-12 left-[60%] w-full h-0.5 bg-gradient-to-r from-[var(--accent)] to-transparent" />
                  )}

                  {/* Step icon */}
                  <div className="relative inline-flex items-center justify-center w-24 h-24 mb-8">
                    <div className="absolute inset-0 bg-[var(--accent)]/10 rounded-3xl rotate-6" />
                    <div className="absolute inset-0 bg-white rounded-3xl shadow-lg border border-gray-100" />
                    <div className="relative text-[var(--primary)]">
                      {item.icon}
                    </div>
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--primary-dark)] font-bold text-sm flex items-center justify-center shadow-lg">
                      {index + 1}
                    </div>
                  </div>

                  <h3 className="text-xl font-bold text-[var(--foreground)] mb-3">
                    {t(`howItWorks.steps.${item.key}.title`)}
                  </h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed max-w-xs mx-auto">
                    {t(`howItWorks.steps.${item.key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

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
                  <h3 className="mb-2 text-base font-semibold text-[var(--foreground)] transition group-hover:text-[var(--primary)]">
                    {tBlog(`posts.${slug}.title`)}
                  </h3>
                  <p className="mb-3 text-sm leading-relaxed text-[var(--foreground-muted)]">
                    {tBlog(`posts.${slug}.description`)}
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)]">
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

        {/* ================================================================
            FAQ
            ================================================================ */}
        <section className="py-24 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                FAQ
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
                {t('faq.title')}
              </h2>
            </div>

            <div className="space-y-4">
              {FAQ_KEYS.map((key) => (
                <details
                  key={key}
                  className="group bg-[var(--background-alt)] rounded-2xl overflow-hidden"
                >
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                    <span className="font-semibold text-[var(--foreground)] pr-4">
                      {t(`faq.items.${key}.question`)}
                    </span>
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 group-open:bg-[var(--accent)] transition-colors shadow-sm">
                      <svg
                        className="w-4 h-4 text-[var(--foreground-muted)] group-open:text-[var(--primary-dark)] group-open:rotate-180 transition-all"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </summary>
                  <div className="px-6 pb-6">
                    <p className="text-[var(--foreground-muted)] leading-relaxed">
                      {t(`faq.items.${key}.answer`)}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            FINAL CTA
            ================================================================ */}
        <section className="py-24 bg-[var(--background-alt)]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-[2.5rem] mesh-gradient p-12 sm:p-16 lg:p-20">
              {/* Grid overlay */}
              <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--accent)]/20 rounded-full blur-[100px]" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-[var(--primary-light)]/20 rounded-full blur-[80px]" />

              <div className="relative text-center">
                {/* Live badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm font-semibold text-white/90 mb-8">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                  </span>
                  {t('hero.trustSignals.free')}
                </div>

                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight">
                  {t('cta.title')}
                </h2>
                <p className="text-lg sm:text-xl text-white/70 mb-10 max-w-2xl mx-auto leading-relaxed">
                  {t('cta.subtitle')}
                </p>

                {/* CTA button */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                  <Link
                    href="/trips/new"
                    className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all"
                  >
                    <span>{t('cta.button')}</span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>
                </div>

                {/* Newsletter signup */}
                <div className="pt-8 border-t border-white/10 max-w-md mx-auto">
                  <p className="text-sm text-white/50 mb-4">
                    {t('cta.mobileNotify')}
                  </p>
                  <EmailSubscribe variant="dark" source="group-trip-planner-cta" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
