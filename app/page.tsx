import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import PhoneMockup from '@/components/PhoneMockup';
import EmailSubscribe from '@/components/EmailSubscribe';
import Footer from '@/components/Footer';
import CuratedEscapes from '@/components/templates/CuratedEscapes';
import Link from 'next/link';
import { generateFAQSchema, jsonLdScriptProps } from '@/lib/seo/structured-data';

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
   FAQ DATA - Used for both display and structured data (SEO)
   ============================================================================ */
const FAQS = [
  {
    question: 'Is this AI travel planner really free?',
    answer: 'Yes, MonkeyTravel is 100% free. Create unlimited trip itineraries, customize them, export to PDF, and share with friends — all without paying anything. We plan to add optional premium features down the road, but the core AI trip planner will always be free.',
  },
  {
    question: 'Do I need to download an app?',
    answer: 'Nope. MonkeyTravel works entirely in your browser — phone, tablet, or computer. Just visit monkeytravel.app and start planning. We\'re building iOS and Android apps for an even smoother experience, coming soon.',
  },
  {
    question: 'How does the AI itinerary generator work?',
    answer: 'Tell us where you\'re going, when, and for how long. Our AI analyzes thousands of options and builds three complete day-by-day itineraries at different price points — in about 30 seconds. Each plan includes restaurants, attractions, timing, and walking routes.',
  },
  {
    question: 'Can I edit the itinerary?',
    answer: 'Of course. Swap any activity, add your own spots, adjust timing, or ask our AI assistant for alternatives. It\'s a smart starting point, not a rigid schedule.',
  },
  {
    question: 'What destinations can I plan?',
    answer: 'We cover 180+ destinations worldwide — from Paris and Tokyo to Lisbon and Bali. More locations are being added regularly. If we don\'t have your destination yet, let us know.',
  },
  {
    question: 'Can I share my trip with friends?',
    answer: 'Absolutely. Every trip has a share button that generates a link. Send it to your travel group and they can see the full itinerary. Want to invite them to MonkeyTravel? You\'ll both earn rewards.',
  },
];

// Generate FAQ structured data for SEO (rich snippets in Google)
const faqSchema = generateFAQSchema(FAQS);

export default async function Home() {
  // Smart routing: Redirect authenticated users to their dashboard
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Returning user - skip marketing, go directly to trips dashboard
    redirect('/trips');
  }

  // New/anonymous user - show landing page
  return (
    <>
      {/* FAQ Structured Data for rich snippets in Google Search */}
      <script {...jsonLdScriptProps(faqSchema)} />

      <Navbar />

      <main>
        {/* ================================================================
            HERO SECTION - High Impact, Conversion Focused
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
                {/* Live Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-8">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-sm font-semibold text-emerald-700">
                    Live Now — Try It Free
                  </span>
                </div>

                {/* Main Headline - Primary keyword: AI travel planner */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--foreground)] leading-[1.08] tracking-tight mb-6">
                  The AI Travel Planner
                  <br />
                  <span className="gradient-text-blue">That Actually Works</span>
                </h1>

                {/* Sub-headline with value proposition */}
                <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                  Drop a destination. Get a <span className="text-[var(--foreground)] font-medium">complete day-by-day itinerary</span> in 30 seconds — with restaurants, timings, and local gems tailored to your budget.
                </p>

                {/* Primary CTAs */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-8">
                  <Link
                    href="/trips/new"
                    className="group relative px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30 flex items-center justify-center gap-2"
                  >
                    <span>Plan My Trip Free</span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>
                  <Link
                    href="/auth/login"
                    className="px-8 py-4 bg-white border-2 border-gray-200 text-[var(--foreground)] font-semibold rounded-xl hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all flex items-center justify-center gap-2"
                  >
                    <span>Sign In</span>
                  </Link>
                </div>

                {/* Trust Signals */}
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 sm:gap-6 text-sm text-[var(--foreground-muted)]">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>100% Free</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>No Credit Card</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Instant Access</span>
                  </div>
                </div>

                {/* Explore Link */}
                <div className="mt-6 text-center lg:text-left">
                  <Link
                    href="/explore"
                    className="inline-flex items-center gap-2 text-sm text-[var(--foreground-muted)] hover:text-[var(--primary)] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span>Or explore trips shared by our community</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
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
                      <div className="text-xs text-[var(--foreground-muted)]">AI Powered</div>
                      <div className="text-sm font-semibold text-[var(--foreground)]">30 Seconds</div>
                    </div>
                  </div>

                  <div className="absolute -right-4 bottom-32 glass-card rounded-2xl p-4 shadow-lg hidden lg:flex items-center gap-3 animate-float" style={{ animationDelay: '1s' }}>
                    <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--foreground-muted)]">Web App</div>
                      <div className="text-sm font-semibold text-emerald-600">Live Now</div>
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
            SOCIAL PROOF - Quick Stats
            ================================================================ */}
        <section className="py-8 bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-16 text-center">
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">30s</div>
                <div className="text-sm text-[var(--foreground-muted)]">From idea to itinerary</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">180+</div>
                <div className="text-sm text-[var(--foreground-muted)]">Destinations ready</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">3</div>
                <div className="text-sm text-[var(--foreground-muted)]">Budget options every trip</div>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            PROBLEM SECTION - Pain Points
            ================================================================ */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                You deserve better than <span className="text-[var(--error)]">this</span>
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                47 browser tabs. 3 spreadsheets. 6 hours of research. And you still don't know where to eat on day two.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {[
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  title: 'Research Rabbit Holes',
                  description: '"Just one more blog post" turns into 4 hours. You\'re tired before the trip even starts.',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  title: 'Analysis Paralysis',
                  description: '500 restaurants, 200 attractions, conflicting reviews. How do you even choose?',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  ),
                  title: 'Copy-Paste Itineraries',
                  description: 'Generic "Top 10" lists that ignore your pace, budget, and what actually excites you.',
                },
              ].map((item, index) => (
                <div key={index} className="text-center p-8 rounded-2xl bg-[var(--background-alt)] border border-gray-100">
                  <div className="w-14 h-14 rounded-2xl bg-red-50 text-[var(--error)] flex items-center justify-center mx-auto mb-5">
                    {item.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">{item.title}</h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            SOLUTION SECTION - How MonkeyTravel Solves It
            ================================================================ */}
        <section id="features" className="py-24 bg-[var(--background-alt)] relative overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern-accent opacity-30" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/10 text-[var(--primary-dark)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                AI Itinerary Generator
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                Everything you need,{' '}
                <span className="gradient-text">nothing you don't</span>
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                Our AI vacation planner builds complete itineraries with real restaurants, actual attractions, and smart timing. No fluff, just trips that work.
              </p>
            </div>

            {/* Feature Cards */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ),
                  title: '30-Second Itineraries',
                  description: 'Pick a destination, get a complete personalized travel plan. Our AI does in seconds what takes hours.',
                  color: 'bg-amber-50 text-amber-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  title: 'Your Budget, Your Rules',
                  description: 'Every trip comes in Budget, Balanced, and Premium. Same destination, three ways to experience it.',
                  color: 'bg-emerald-50 text-emerald-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ),
                  title: 'Day-by-Day Breakdown',
                  description: 'Morning coffee spots, afternoon adventures, evening restaurants — all timed and mapped out.',
                  color: 'bg-blue-50 text-blue-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  ),
                  title: 'Make It Yours',
                  description: "Swap any activity, add your must-sees, adjust timing. It's a starting point, not a locked plan.",
                  color: 'bg-violet-50 text-violet-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  ),
                  title: 'Invite Friends, Get Free Trips',
                  description: 'Share MonkeyTravel with friends. When they sign up, you both earn rewards toward free premium features.',
                  color: 'bg-rose-50 text-rose-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  ),
                  title: 'Real Data, Real Places',
                  description: "Actual photos, genuine ratings, official hours. We verify so you don't have to second-guess.",
                  color: 'bg-cyan-50 text-cyan-500',
                },
              ].map((feature, index) => (
                <div
                  key={index}
                  className="group p-8 rounded-3xl bg-white border border-gray-100 card-hover"
                >
                  <div className={`w-14 h-14 rounded-2xl ${feature.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-semibold text-[var(--foreground)] mb-3">{feature.title}</h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            HOW IT WORKS - Simple Steps
            ================================================================ */}
        <section id="how-it-works" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-semibold mb-6">
                Free Trip Planner
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                From &ldquo;I want to go to...&rdquo; to{' '}
                <span className="gradient-text-blue">done</span>
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {[
                {
                  step: '1',
                  title: 'Pick Your Destination',
                  description: 'Type where you want to go — Paris, Tokyo, or anywhere. Add dates and travelers.',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  ),
                },
                {
                  step: '2',
                  title: 'AI Builds 3 Itineraries',
                  description: 'In 30 seconds, get three complete day-by-day plans at Budget, Balanced, and Premium price points.',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  ),
                },
                {
                  step: '3',
                  title: 'Customize & Share',
                  description: 'Tweak anything, share with travel buddies, export to PDF. Then pack your bags.',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  ),
                },
              ].map((item, index) => (
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

                  <h3 className="text-xl font-bold text-[var(--foreground)] mb-3">{item.title}</h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed max-w-xs mx-auto">{item.description}</p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="text-center mt-16">
              <Link
                href="/trips/new"
                className="inline-flex items-center gap-2 px-8 py-4 bg-[var(--primary)] text-white font-bold rounded-xl hover:bg-[var(--primary-light)] transition-colors shadow-lg"
              >
                Try It Free Now
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        {/* ================================================================
            CURATED ESCAPES - Template Trips Showcase
            ================================================================ */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <CuratedEscapes />
          </div>
        </section>

        {/* ================================================================
            APP PREVIEW SECTION
            ================================================================ */}
        <section className="py-24 bg-[var(--background-alt)] overflow-hidden">
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
                  Web App Live • Mobile Coming Soon
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                  Your free trip planner{' '}
                  <span className="gradient-text">is ready</span>
                </h2>
                <p className="text-lg text-[var(--foreground-muted)] mb-10 leading-relaxed">
                  No download needed. Start planning trips in your browser right now — it only takes 30 seconds to get your first personalized itinerary. Mobile apps are on the way.
                </p>

                <ul className="space-y-5 mb-10">
                  {[
                    { text: 'Web app live now — completely free', icon: '✓', highlight: true },
                    { text: 'Day-by-day itineraries with timing', icon: '📅' },
                    { text: 'Real photos, ratings & hours', icon: '📷' },
                    { text: 'Export to PDF, share with friends', icon: '📤' },
                    { text: 'iOS & Android coming soon', icon: '📱' },
                  ].map((item, index) => (
                    <li key={index} className={`flex items-center gap-4 ${item.highlight ? 'p-3 -mx-3 rounded-xl bg-emerald-50 border border-emerald-100' : ''}`}>
                      <span className={`text-xl ${item.highlight ? 'text-emerald-500' : ''}`}>{item.icon}</span>
                      <span className={`font-medium ${item.highlight ? 'text-emerald-700' : 'text-[var(--foreground)]'}`}>{item.text}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/trips/new"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30"
                >
                  Plan My First Trip
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            FAQ SECTION
            ================================================================ */}
        <section id="support" className="py-24 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                FAQ
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
                Questions? We've got answers
              </h2>
            </div>

            <div className="space-y-4">
              {FAQS.map((faq, index) => (
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
                Still have questions? We'd love to hear from you.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="mailto:support@monkeytravel.app"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--primary)] text-white font-medium hover:bg-[var(--primary-light)] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Email Support
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            FINAL CTA - High Converting
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
                  100% Free to Use
                </div>

                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight">
                  Ready to skip the planning headaches?
                </h2>
                <p className="text-lg sm:text-xl text-white/70 mb-4 max-w-2xl mx-auto leading-relaxed">
                  Your perfect trip is 30 seconds away. No credit card, no catch — just AI-powered itineraries built for how you actually travel.
                </p>
                <p className="text-base text-white/50 mb-10 max-w-2xl mx-auto">
                  Love it? Invite friends and earn free premium features.
                </p>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                  <Link
                    href="/trips/new"
                    className="group px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all flex items-center justify-center gap-2"
                  >
                    <span>Plan My Trip Now</span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>
                  <Link
                    href="/auth/login"
                    className="px-8 py-4 bg-white/10 border border-white/20 text-white font-semibold rounded-xl hover:bg-white/20 transition-all flex items-center justify-center"
                  >
                    Sign In
                  </Link>
                </div>

                {/* Newsletter signup (secondary) */}
                <div className="pt-8 border-t border-white/10 max-w-md mx-auto">
                  <p className="text-sm text-white/50 mb-4">
                    Get notified when mobile apps launch
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
