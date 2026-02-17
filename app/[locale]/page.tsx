import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import PhoneMockup from '@/components/PhoneMockup';
import EmailSubscribe from '@/components/EmailSubscribe';
import Footer from '@/components/Footer';
import CuratedEscapes from '@/components/templates/CuratedEscapes';
import { Link } from '@/lib/i18n/routing';
import { generateFAQSchema, jsonLdScriptProps } from '@/lib/seo/structured-data';
import { TourTrigger } from '@/components/tour';
import { getTranslations } from 'next-intl/server';
import { destinations } from '@/lib/destinations/data';
import { DestinationCard } from '@/components/destinations';
import type { Locale } from '@/lib/destinations/types';
import type { Metadata } from 'next';

const BASE_URL = 'https://monkeytravel.app';

const META: Record<string, { title: string; description: string }> = {
  en: {
    title: 'MonkeyTravel - AI-Powered Trip Planning Made Easy',
    description: 'Plan your perfect trip with AI-generated day-by-day itineraries. Get personalized travel plans in minutes — free, no credit card required.',
  },
  es: {
    title: 'MonkeyTravel - Planificación de Viajes con IA',
    description: 'Planifica tu viaje perfecto con itinerarios generados por IA día a día. Obtén planes de viaje personalizados en minutos — gratis, sin tarjeta de crédito.',
  },
  it: {
    title: 'MonkeyTravel - Pianificazione Viaggi con IA',
    description: 'Pianifica il tuo viaggio perfetto con itinerari generati dall\'IA giorno per giorno. Ottieni piani di viaggio personalizzati in pochi minuti — gratis, senza carta di credito.',
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const meta = META[locale] || META.en;

  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: locale === 'en' ? BASE_URL : `${BASE_URL}/${locale}`,
      languages: {
        en: BASE_URL,
        es: `${BASE_URL}/es`,
        it: `${BASE_URL}/it`,
        'x-default': BASE_URL,
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: 'website',
      url: locale === 'en' ? BASE_URL : `${BASE_URL}/${locale}`,
    },
  };
}

/* ============================================================================
   APP SCREENSHOTS CONFIGURATION
   ============================================================================ */
const APP_SCREENSHOTS = {
  hero: '/screenshots/trip-barcelona-hero.png' as string | undefined,
  preview: {
    left: '/screenshots/trip-lisbon-hero.png' as string | undefined,
    center: '/screenshots/trip-barcelona-itinerary.png' as string | undefined,
    right: '/screenshots/trip-porto-hero.png' as string | undefined,
  },
};

/* ============================================================================
   FAQ KEYS - Used to build FAQ data from translations
   ============================================================================ */
const FAQ_KEYS = ['free', 'noApp', 'howAiWorks', 'editItinerary', 'destinations', 'planWithFriends'] as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // Smart routing: Redirect authenticated users to their dashboard
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Returning user - skip marketing, go directly to trips dashboard
    redirect('/trips');
  }

  // Get translations for landing page
  const t = await getTranslations('landing');
  const tDest = await getTranslations('destinations');

  // Build FAQ data from translations for both display and structured data (SEO)
  const faqs = FAQ_KEYS.map(key => ({
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));
  const faqSchema = generateFAQSchema(faqs);

  // New/anonymous user - show landing page
  return (
    <>
      {/* FAQ Structured Data for rich snippets in Google Search */}
      <script {...jsonLdScriptProps(faqSchema)} />

      <Navbar />

      <main>
        {/* ================================================================
            1. HERO SECTION - Group Planning Angle
            ================================================================ */}
        <section className="relative min-h-screen pt-20 pb-12 overflow-hidden hero-gradient">
          {/* Subtle grid overlay */}
          <div className="absolute inset-0 bg-grid-pattern-light opacity-50" />

          {/* Decorative orbs */}
          <div className="absolute top-32 left-[10%] w-72 h-72 bg-[var(--accent)]/10 rounded-full blur-[100px] animate-pulse-glow" />
          <div className="absolute top-64 right-[5%] w-96 h-96 bg-[var(--primary)]/8 rounded-full blur-[120px] animate-pulse-glow" style={{ animationDelay: '2s' }} />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center min-h-[calc(100vh-5rem)]">

              {/* Left - Content */}
              <div className="pt-8 lg:pt-0 text-center lg:text-left order-2 lg:order-1">
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

                {/* Main Headline */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--foreground)] leading-[1.08] tracking-tight mb-6">
                  {t('hero.titleLine1')}
                  <br />
                  <span className="gradient-text-blue">{t('hero.titleHighlight')}</span>
                </h1>

                {/* Sub-headline with value proposition */}
                <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                  {t('hero.subtitleStart')} <span className="text-[var(--foreground)] font-medium">{t('hero.subtitleHighlight')}</span> {t('hero.subtitleEnd')}
                </p>

                {/* Primary CTAs */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-8">
                  <TourTrigger
                    variant="primary-cta"
                    skipToAuthIfCompleted={true}
                  >
                    <span>{t('hero.cta')}</span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </TourTrigger>
                  <Link
                    href="/auth/login"
                    className="px-8 py-4 bg-white border-2 border-gray-200 text-[var(--foreground)] font-semibold rounded-xl hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all flex items-center justify-center gap-2"
                  >
                    <span>{t('hero.signIn')}</span>
                  </Link>
                </div>

                {/* Trust Signals */}
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 sm:gap-6 text-sm text-[var(--foreground-muted)]">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>{t('hero.trustSignals.free')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>{t('hero.trustSignals.noCard')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>{t('hero.trustSignals.instant')}</span>
                  </div>
                </div>

              </div>

              {/* Right - Phone Mockup (hidden on mobile) */}
              <div className="relative hidden lg:flex lg:order-2 justify-center lg:justify-end">
                <div className="relative">
                  {/* Glow behind phone */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-gradient-to-br from-[var(--accent)]/20 to-[var(--primary)]/15 rounded-full blur-[80px]" />

                  <div className="relative animate-float-slow">
                    <PhoneMockup scale="lg" screenImage={APP_SCREENSHOTS.hero} />
                  </div>

                  {/* Floating feature cards */}
                  <div className="absolute -left-4 top-20 glass-card rounded-2xl p-4 shadow-lg hidden lg:flex items-center gap-3 animate-float" style={{ animationDelay: '0.5s' }}>
                    <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--primary-dark)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--foreground-muted)]">{t('hero.floatingCards.aiPowered')}</div>
                      <div className="text-sm font-semibold text-[var(--foreground)]">{t('hero.floatingCards.thirtySeconds')}</div>
                    </div>
                  </div>

                  <div className="absolute -right-4 bottom-32 glass-card rounded-2xl p-4 shadow-lg hidden lg:flex items-center gap-3 animate-float" style={{ animationDelay: '1s' }}>
                    <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--foreground-muted)]">{t('hero.floatingCards.webApp')}</div>
                      <div className="text-sm font-semibold text-emerald-600">{t('hero.floatingCards.liveNow')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce-subtle">
            <div className="w-6 h-10 rounded-full border-2 border-[var(--foreground-light)] flex items-start justify-center p-2">
              <div className="w-1.5 h-3 bg-[var(--foreground-light)] rounded-full" />
            </div>
          </div>
        </section>

        {/* ================================================================
            2. SOCIAL PROOF - Quick Stats (4th stat added)
            ================================================================ */}
        <section className="py-8 bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-16 text-center">
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">30s</div>
                <div className="text-sm text-[var(--foreground-muted)]">{t('stats.ideaToItinerary')}</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">180+</div>
                <div className="text-sm text-[var(--foreground-muted)]">{t('stats.destinationsReady')}</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">100%</div>
                <div className="text-sm text-[var(--foreground-muted)]">{t('stats.personalizedToYou')}</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">8</div>
                <div className="text-sm text-[var(--foreground-muted)]">{t('stats.friendsPerTrip')}</div>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            3. PROBLEM SECTION - Group-specific Pain Points
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
              {([
                {
                  key: 'research',
                  icon: (
                    // Chat bubble with "..." — endless group chat
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  ),
                },
                {
                  key: 'analysis',
                  icon: (
                    // Tired person with clipboard — one person does everything
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ),
                },
                {
                  key: 'copyPaste',
                  icon: (
                    // Two opposing arrows — nobody can agree
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  ),
                },
              ] as const).map((item, index) => (
                <div key={index} className="text-center p-8 rounded-2xl bg-[var(--background-alt)] border border-gray-100">
                  <div className="w-14 h-14 rounded-2xl bg-red-50 text-[var(--error)] flex items-center justify-center mx-auto mb-5">
                    {item.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">{t(`problem.cards.${item.key}.title`)}</h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed">{t(`problem.cards.${item.key}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            4. AI CHAT DEMO — NEW SECTION
            ================================================================ */}
        <section className="py-20 bg-[var(--background-alt)]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {t('aiChatDemo.badge')}
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('aiChatDemo.title')}
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                {t('aiChatDemo.subtitle')}
              </p>
            </div>

            {/* Chat mockup */}
            <div className="max-w-2xl mx-auto">
              {/* User message 1 */}
              <div className="flex justify-end mb-4">
                <div className="bg-[var(--primary)] text-white px-5 py-3 rounded-2xl rounded-br-md max-w-md text-sm sm:text-base">
                  {t('aiChatDemo.chat.user1')}
                </div>
              </div>
              {/* AI response 1 */}
              <div className="flex justify-start mb-4">
                <div className="bg-white text-gray-800 px-5 py-3 rounded-2xl rounded-bl-md max-w-md shadow-sm border border-gray-100 text-sm sm:text-base">
                  {t('aiChatDemo.chat.ai1')}
                </div>
              </div>
              {/* User message 2 */}
              <div className="flex justify-end mb-4">
                <div className="bg-[var(--primary)] text-white px-5 py-3 rounded-2xl rounded-br-md max-w-md text-sm sm:text-base">
                  {t('aiChatDemo.chat.user2')}
                </div>
              </div>
              {/* AI response 2 */}
              <div className="flex justify-start mb-6">
                <div className="bg-white text-gray-800 px-5 py-3 rounded-2xl rounded-bl-md max-w-md shadow-sm border border-gray-100 text-sm sm:text-base">
                  {t('aiChatDemo.chat.ai2')}
                </div>
              </div>
            </div>

            <div className="text-center">
              <TourTrigger
                variant="custom"
                skipToAuthIfCompleted={true}
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--primary)] text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-lg cursor-pointer"
              >
                {t('aiChatDemo.cta')}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </TourTrigger>
            </div>
          </div>
        </section>

        {/* ================================================================
            5. SOLUTION SECTION - Objection Handling
            ================================================================ */}
        <section id="features" className="py-24 bg-white relative overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern-accent opacity-30" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/10 text-[var(--primary-dark)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                {t('solution.badge')}
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('solution.title')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                {t('solution.subtitle')}
              </p>
            </div>

            {/* Feature Cards */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {([
                {
                  key: 'speed',
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ),
                  color: 'bg-amber-50 text-amber-500',
                },
                {
                  key: 'agent',
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  ),
                  color: 'bg-emerald-50 text-emerald-500',
                },
                {
                  key: 'dayByDay',
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ),
                  color: 'bg-blue-50 text-blue-500',
                },
                {
                  key: 'customizable',
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  ),
                  color: 'bg-violet-50 text-violet-500',
                },
                {
                  key: 'collaborate',
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  ),
                  color: 'bg-rose-50 text-rose-500',
                  hasBadge: true,
                },
                {
                  key: 'realData',
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  ),
                  color: 'bg-cyan-50 text-cyan-500',
                },
              ] as const).map((feature, index) => (
                <div
                  key={index}
                  className="group relative p-8 rounded-3xl bg-[var(--background-alt)] border border-gray-100 card-hover"
                >
                  {'hasBadge' in feature && feature.hasBadge && (
                    <span className="absolute top-4 right-4 px-2.5 py-1 text-xs font-bold bg-gradient-to-r from-purple-500 to-rose-500 text-white rounded-full">
                      {t('solution.cards.collaborate.badge')}
                    </span>
                  )}
                  <div className={`w-14 h-14 rounded-2xl ${feature.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-semibold text-[var(--foreground)] mb-3">{t(`solution.cards.${feature.key}.title`)}</h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed">{t(`solution.cards.${feature.key}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            6. COLLABORATION SECTION - Expanded (moved up from position 8)
            ================================================================ */}
        <section className="py-20 bg-gradient-to-b from-purple-50/50 to-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-100 text-purple-700 text-sm font-semibold mb-4">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                </span>
                {t('collaboration.badge')}
              </span>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 tracking-tight">
                {t('collaboration.title')}{" "}
                <span className="bg-gradient-to-r from-purple-600 to-rose-500 bg-clip-text text-transparent">
                  {t('collaboration.titleHighlight')}
                </span>
              </h2>
              <p className="text-lg text-gray-600 max-w-xl mx-auto leading-relaxed">
                {t('collaboration.description')}
              </p>
            </div>

            {/* Feature Pills */}
            <div className="flex flex-wrap justify-center gap-3 mb-12">
              {([
                { icon: "👥", key: "inviteFriends" },
                { icon: "🗳️", key: "voteTogether" },
                { icon: "⚡", key: "realtimeSync" },
                { icon: "✏️", key: "roleAccess" },
              ] as const).map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-5 py-3 bg-white rounded-full shadow-md border border-purple-100 hover:shadow-lg hover:border-purple-200 transition-all"
                >
                  <span className="text-xl">{item.icon}</span>
                  <span className="font-medium text-gray-700">{t(`collaboration.pills.${item.key}`)}</span>
                </div>
              ))}
            </div>

            {/* Feature Sub-grid */}
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-12">
              {(['invite', 'vote', 'sync'] as const).map((key) => (
                <div key={key} className="p-6 rounded-2xl bg-white border border-purple-100 text-center shadow-sm">
                  <h3 className="font-semibold text-gray-900 mb-2">{t(`collaboration.features.${key}.title`)}</h3>
                  <p className="text-sm text-gray-600">{t(`collaboration.features.${key}.description`)}</p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="text-center">
              <TourTrigger
                variant="custom"
                skipToAuthIfCompleted={true}
                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-600 to-rose-500 text-white rounded-xl font-bold text-lg hover:from-purple-700 hover:to-rose-600 transition-all shadow-lg hover:shadow-xl cursor-pointer"
              >
                {t('collaboration.cta')}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </TourTrigger>
              <p className="mt-4 text-sm text-gray-500">
                {t('collaboration.subtitle')}
              </p>
            </div>
          </div>
        </section>

        {/* ================================================================
            7. HOW IT WORKS - Simple Steps
            ================================================================ */}
        <section id="how-it-works" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-semibold mb-6">
                {t('howItWorks.badge')}
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('howItWorks.title')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                {t('howItWorks.subtitle')}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {([
                {
                  step: '1',
                  key: 'destination',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  ),
                },
                {
                  step: '2',
                  key: 'aiBuild',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  ),
                },
                {
                  step: '3',
                  key: 'customize',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  ),
                },
              ] as const).map((item, index) => (
                <div key={index} className="relative text-center">
                  {/* Connector line */}
                  {index < 2 && (
                    <div className="hidden md:block absolute top-12 left-[60%] w-full h-0.5 bg-gradient-to-r from-[var(--accent)] to-transparent" />
                  )}

                  {/* Step number */}
                  <div className="relative inline-flex items-center justify-center w-24 h-24 mb-8">
                    <div className="absolute inset-0 bg-[var(--accent)]/10 rounded-3xl rotate-6" />
                    <div className="absolute inset-0 bg-white rounded-3xl shadow-lg border border-gray-100" />
                    <div className="relative text-[var(--primary)]">
                      {item.icon}
                    </div>
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--primary-dark)] font-bold text-sm flex items-center justify-center shadow-lg">
                      {item.step}
                    </div>
                  </div>

                  <h3 className="text-xl font-bold text-[var(--foreground)] mb-3">{t(`howItWorks.steps.${item.key}.title`)}</h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed max-w-xs mx-auto">{t(`howItWorks.steps.${item.key}.description`)}</p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="text-center mt-16">
              <TourTrigger
                variant="custom"
                skipToAuthIfCompleted={true}
                className="inline-flex items-center gap-2 px-8 py-4 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors shadow-lg cursor-pointer"
              >
                {t('howItWorks.cta')}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </TourTrigger>
            </div>
          </div>
        </section>

        {/* ================================================================
            8. CURATED ESCAPES - Template Trips Showcase
            ================================================================ */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <CuratedEscapes />
          </div>
        </section>

        {/* ================================================================
            9. WHAT YOU WON'T FIND HERE — NEW SECTION (Anti-Features)
            ================================================================ */}
        <section className="py-20 bg-[var(--background-alt)]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 text-gray-700 text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {t('antiFeatures.badge')}
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                {t('antiFeatures.title')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                {t('antiFeatures.subtitle')}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {([
                {
                  key: 'paywall',
                  icon: (
                    // Crossed-out dollar
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-12.728 12.728" />
                    </svg>
                  ),
                },
                {
                  key: 'download',
                  icon: (
                    // Crossed-out download arrow
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-12.728 12.728" />
                    </svg>
                  ),
                },
                {
                  key: 'hallucinations',
                  icon: (
                    // Crossed-out ghost/fake
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-12.728 12.728" />
                    </svg>
                  ),
                },
                {
                  key: 'soloOnly',
                  icon: (
                    // Crossed-out single person
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-12.728 12.728" />
                    </svg>
                  ),
                },
                {
                  key: 'generic',
                  icon: (
                    // Crossed-out list
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-12.728 12.728" />
                    </svg>
                  ),
                },
              ] as const).map((item, index) => (
                <div key={index} className="relative p-6 rounded-2xl bg-white border border-gray-100 shadow-sm">
                  <div className="w-12 h-12 rounded-xl bg-red-50 text-red-400 flex items-center justify-center mb-4">
                    {item.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">{t(`antiFeatures.items.${item.key}.title`)}</h3>
                  <p className="text-sm text-[var(--foreground-muted)] leading-relaxed">{t(`antiFeatures.items.${item.key}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            10. APP PREVIEW SECTION
            ================================================================ */}
        <section className="py-24 bg-white overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              {/* Phone Mockups */}
              <div className="relative">
                <div className="relative flex justify-center">
                  {/* Background glow */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-r from-[var(--accent)]/15 to-[var(--primary)]/10 rounded-full blur-[100px]" />

                  {/* Phone arrangement */}
                  <div className="relative">
                    <div className="absolute -left-16 top-16 scale-[0.85] opacity-50 -rotate-12 hidden md:block">
                      <PhoneMockup scale="md" screenImage={APP_SCREENSHOTS.preview.left} />
                    </div>
                    <div className="relative z-10">
                      <PhoneMockup scale="lg" screenImage={APP_SCREENSHOTS.preview.center} />
                    </div>
                    <div className="absolute -right-16 top-16 scale-[0.85] opacity-50 rotate-12 hidden md:block">
                      <PhoneMockup scale="md" screenImage={APP_SCREENSHOTS.preview.right} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/10 text-[var(--primary-dark)] text-sm font-semibold mb-6">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  {t('appPreview.badge')}
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                  {t('appPreview.title')}{' '}
                  <span className="gradient-text">{t('appPreview.titleHighlight')}</span>
                </h2>
                <p className="text-lg text-[var(--foreground-muted)] mb-10 leading-relaxed">
                  {t('appPreview.description')}
                </p>

                <ul className="space-y-5 mb-10">
                  {([
                    { key: 'webApp', icon: '✓', highlight: true },
                    { key: 'dayByDay', icon: '📅' },
                    { key: 'realPhotos', icon: '📷' },
                    { key: 'export', icon: '📤' },
                    { key: 'mobile', icon: '📱' },
                  ] as const).map((item, index) => (
                    <li key={index} className={`flex items-center gap-4 ${'highlight' in item && item.highlight ? 'p-3 -mx-3 rounded-xl bg-emerald-50 border border-emerald-100' : ''}`}>
                      <span className={`text-xl ${'highlight' in item && item.highlight ? 'text-emerald-500' : ''}`}>{item.icon}</span>
                      <span className={`font-medium ${'highlight' in item && item.highlight ? 'text-emerald-700' : 'text-[var(--foreground)]'}`}>{t(`appPreview.features.${item.key}`)}</span>
                    </li>
                  ))}
                </ul>

                <TourTrigger
                  variant="custom"
                  skipToAuthIfCompleted={true}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30 cursor-pointer"
                >
                  {t('appPreview.cta')}
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </TourTrigger>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            11. POPULAR DESTINATIONS - SEO & Internal Linking
            ================================================================ */}
        <section className="py-20 bg-[var(--background-alt)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
                {tDest('sections.popularDestinations')}
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                {tDest('index.subtitle')}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {destinations.slice(0, 6).map((destination) => (
                <DestinationCard
                  key={destination.slug}
                  destination={destination}
                  locale={locale as Locale}
                  planTripLabel={tDest('cta.planTrip')}
                  daysLabel={tDest('card.days', { days: destination.stats.avgStayDays })}
                  tagLabels={Object.fromEntries(
                    ["romantic","cultural","foodie","urban","historical","beach","nightlife","adventure","nature","wellness","shopping","offbeat"].map(
                      (tag) => [tag, tDest(`tags.${tag}`)]
                    )
                  )}
                />
              ))}
            </div>

            <div className="text-center mt-10">
              <Link
                href="/destinations"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] font-semibold hover:bg-[var(--primary)]/10 transition-colors"
              >
                {tDest('cta.viewAllDestinations')}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        {/* ================================================================
            12. FAQ SECTION
            ================================================================ */}
        <section id="support" className="py-24 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('faq.badge')}
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
                {t('faq.title')}
              </h2>
            </div>

            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <details
                  key={index}
                  className="group bg-[var(--background-alt)] rounded-2xl overflow-hidden"
                >
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                    <span className="font-semibold text-[var(--foreground)] pr-4">{faq.question}</span>
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
                    <p className="text-[var(--foreground-muted)] leading-relaxed">{faq.answer}</p>
                  </div>
                </details>
              ))}
            </div>

            {/* Contact */}
            <div className="mt-12 text-center p-8 bg-[var(--background-alt)] rounded-3xl">
              <p className="text-[var(--foreground-muted)] mb-6">
                {t('faq.contact')}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="mailto:support@monkeytravel.app"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--primary)] text-white font-medium hover:opacity-90 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {t('faq.emailSupport')}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            13. FINAL CTA - Emotional Closing
            ================================================================ */}
        <section className="py-24 bg-white">
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
                <p className="text-lg sm:text-xl text-white/70 mb-4 max-w-2xl mx-auto leading-relaxed">
                  {t('cta.subtitle')}
                </p>
                <p className="text-base text-white/50 mb-10 max-w-2xl mx-auto">
                  {t('cta.referral')}
                </p>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                  <TourTrigger
                    variant="custom"
                    skipToAuthIfCompleted={true}
                    className="group px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>{t('cta.button')}</span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </TourTrigger>
                  <Link
                    href="/auth/login"
                    className="px-8 py-4 bg-white/10 border border-white/20 text-white font-semibold rounded-xl hover:bg-white/20 transition-all flex items-center justify-center"
                  >
                    {t('hero.signIn')}
                  </Link>
                </div>

                {/* Newsletter signup (secondary) */}
                <div className="pt-8 border-t border-white/10 max-w-md mx-auto">
                  <p className="text-sm text-white/50 mb-4">
                    {t('cta.mobileNotify')}
                  </p>
                  <EmailSubscribe variant="dark" source="cta" />
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
