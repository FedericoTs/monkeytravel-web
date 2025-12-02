import Navbar from '@/components/Navbar';
import PhoneMockup from '@/components/PhoneMockup';
import EmailSubscribe from '@/components/EmailSubscribe';
import Footer from '@/components/Footer';

/* ============================================================================
   APP SCREENSHOTS CONFIGURATION
   ============================================================================
   To replace placeholder mockups with real app screenshots:

   1. Add your screenshots to: /public/screenshots/
   2. Recommended size: 1170 x 2532 pixels (iPhone 14 Pro resolution)
   3. Supported formats: PNG, JPG, WebP
   4. Update the paths below to point to your images

   Set to `undefined` to show the placeholder UI instead.
   ============================================================================ */
const APP_SCREENSHOTS = {
  hero: undefined as string | undefined,
  preview: {
    left: undefined as string | undefined,
    center: undefined as string | undefined,
    right: undefined as string | undefined,
  },
};

export default function Home() {
  return (
    <>
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
                {/* Launch Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/15 border border-[var(--accent)]/25 mb-8">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]"></span>
                  </span>
                  <span className="text-sm font-semibold text-[var(--primary-dark)]">
                    Early Access — Limited Spots Available
                  </span>
                </div>

                {/* Main Headline */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--foreground)] leading-[1.08] tracking-tight mb-6">
                  Stop Planning.
                  <br />
                  <span className="gradient-text-blue">Start Exploring.</span>
                </h1>

                {/* Sub-headline with value proposition */}
                <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                  MonkeyTravel uses AI to create <span className="text-[var(--foreground)] font-medium">personalized day-by-day itineraries</span> in
                  seconds — not hours. Tell us where, when, and your budget.
                  We&apos;ll handle the rest.
                </p>

                {/* Email Capture */}
                <div className="mb-6">
                  <EmailSubscribe variant="hero" source="hero" />
                </div>

                {/* Trust Signals */}
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm text-[var(--foreground-muted)]">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-[var(--success)]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Free to join</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-[var(--success)]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>No credit card</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-[var(--success)]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Cancel anytime</span>
                  </div>
                </div>
              </div>

              {/* Right - Phone Mockup */}
              <div className="relative order-1 lg:order-2 flex justify-center lg:justify-end">
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
                      <div className="text-xs text-[var(--foreground-muted)]">AI Generated</div>
                      <div className="text-sm font-semibold text-[var(--foreground)]">In Seconds</div>
                    </div>
                  </div>

                  <div className="absolute -right-4 bottom-32 glass-card rounded-2xl p-4 shadow-lg hidden lg:flex items-center gap-3 animate-float" style={{ animationDelay: '1s' }}>
                    <div className="w-10 h-10 rounded-xl bg-[var(--primary)] flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--foreground-muted)]">3 Budget</div>
                      <div className="text-sm font-semibold text-[var(--foreground)]">Options</div>
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
            PROBLEM SECTION - Pain Points
            ================================================================ */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                Trip planning is <span className="text-[var(--error)]">broken</span>
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                You shouldn&apos;t need 47 browser tabs, 3 spreadsheets, and a week of research
                just to plan a vacation.
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
                  title: 'Hours of Research',
                  description: 'Scrolling through endless reviews, blogs, and forums trying to find the "best" experiences.',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  title: 'Decision Fatigue',
                  description: 'Too many options. Which restaurant? What neighborhood? Morning or afternoon?',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  ),
                  title: 'Generic Itineraries',
                  description: 'Cookie-cutter travel guides that don&apos;t match your style, pace, or budget.',
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
        <section className="py-24 bg-[var(--background-alt)] relative overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern-accent opacity-30" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/10 text-[var(--primary-dark)] text-sm font-semibold mb-6">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                The Solution
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                Your AI travel planner that{' '}
                <span className="gradient-text">actually gets you</span>
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                MonkeyTravel learns your preferences and creates complete, personalized itineraries
                with activities, restaurants, and hotels — organized day by day.
              </p>
            </div>

            {/* Feature Cards */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                  ),
                  title: 'Swipe to Discover',
                  description: 'Like Tinder, but for travel. Swipe through destinations and activities — our AI learns what you love.',
                  color: 'bg-rose-50 text-rose-500',
                  featured: true,
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  ),
                  title: 'AI-Powered Itineraries',
                  description: 'Gemini AI creates detailed day-by-day schedules with morning, afternoon, and evening activities.',
                  color: 'bg-amber-50 text-amber-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  title: '3 Budget Tiers',
                  description: 'Budget, Balanced, or Premium — same destination, same days, but tailored to how you want to spend.',
                  color: 'bg-emerald-50 text-emerald-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ),
                  title: 'Day-by-Day Planning',
                  description: 'Not just a list of places — a complete schedule from breakfast to nightlife, perfectly timed.',
                  color: 'bg-blue-50 text-blue-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  ),
                  title: 'Plan Together',
                  description: 'Invite friends and family to collaborate. Everyone can add ideas and vote on activities.',
                  color: 'bg-violet-50 text-violet-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  ),
                  title: 'Smart Hotel Picks',
                  description: 'AI recommends hotels based on your daily activities — stay close to where you&apos;ll actually be.',
                  color: 'bg-cyan-50 text-cyan-500',
                },
              ].map((feature, index) => (
                <div
                  key={index}
                  className={`group p-8 rounded-3xl bg-white border border-gray-100 card-hover ${feature.featured ? 'md:col-span-2 lg:col-span-1' : ''}`}
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
        <section className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-semibold mb-6">
                How It Works
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                Three steps to your{' '}
                <span className="gradient-text-blue">dream trip</span>
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {[
                {
                  step: '1',
                  title: 'Tell Us Your Style',
                  description: 'Swipe through destinations and activities. Our AI learns your travel personality in minutes.',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                  ),
                },
                {
                  step: '2',
                  title: 'Set Your Trip Details',
                  description: 'Choose your destination, dates, and budget preference. That&apos;s all we need.',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  ),
                },
                {
                  step: '3',
                  title: 'Get Your Itinerary',
                  description: 'AI generates 3 complete itineraries instantly. Pick your favorite, customize, and go!',
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
                  See It In Action
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                  Beautiful, organized,{' '}
                  <span className="gradient-text">ready to explore</span>
                </h2>
                <p className="text-lg text-[var(--foreground-muted)] mb-10 leading-relaxed">
                  MonkeyTravel isn&apos;t just another travel app. It&apos;s your personal AI concierge
                  that understands your style and creates adventures you&apos;ll actually want to take.
                </p>

                <ul className="space-y-5">
                  {[
                    { text: 'Personalized for your travel personality', icon: '🎯' },
                    { text: 'Complete day-by-day schedules', icon: '📅' },
                    { text: 'Budget, Balanced, and Premium options', icon: '💰' },
                    { text: 'Hotels near your daily activities', icon: '🏨' },
                    { text: 'Share and plan with friends', icon: '👥' },
                  ].map((item, index) => (
                    <li key={index} className="flex items-center gap-4">
                      <span className="text-2xl">{item.icon}</span>
                      <span className="text-[var(--foreground)] font-medium">{item.text}</span>
                    </li>
                  ))}
                </ul>
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
                Common questions
              </h2>
            </div>

            <div className="space-y-4">
              {[
                {
                  q: 'When will MonkeyTravel launch?',
                  a: 'We\'re in active development and launching soon. Join the waitlist to get early access and be the first to know when we go live.',
                },
                {
                  q: 'Is it really free?',
                  a: 'MonkeyTravel will have a generous free tier with core features. Premium features like unlimited itineraries and collaborative planning will be available via subscription.',
                },
                {
                  q: 'How does the AI create itineraries?',
                  a: 'We use advanced AI (powered by Gemini) that learns your preferences through our swipe feature. It then generates personalized day-by-day itineraries considering your style, budget, and travel dates.',
                },
                {
                  q: 'Can I plan trips with friends?',
                  a: 'Absolutely! Collaborative planning lets you invite friends and family to contribute ideas, vote on activities, and plan together in real-time.',
                },
                {
                  q: 'What destinations do you support?',
                  a: 'MonkeyTravel works for destinations worldwide. Our AI can create detailed itineraries for major cities, hidden gems, and everything in between.',
                },
              ].map((faq, index) => (
                <details
                  key={index}
                  className="group bg-[var(--background-alt)] rounded-2xl overflow-hidden"
                >
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                    <span className="font-semibold text-[var(--foreground)] pr-4">{faq.q}</span>
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
                    <p className="text-[var(--foreground-muted)] leading-relaxed">{faq.a}</p>
                  </div>
                </details>
              ))}
            </div>

            {/* Contact */}
            <div className="mt-12 text-center p-8 bg-[var(--background-alt)] rounded-3xl">
              <p className="text-[var(--foreground-muted)] mb-6">
                Still have questions? We&apos;d love to hear from you.
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
                {/* Urgency badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm font-semibold text-white/90 mb-8">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]"></span>
                  </span>
                  Early Access Spots Filling Up
                </div>

                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight">
                  Ready to travel smarter?
                </h2>
                <p className="text-lg sm:text-xl text-white/70 mb-10 max-w-2xl mx-auto leading-relaxed">
                  Join thousands of travelers who are tired of endless planning.
                  Get early access and be the first to experience AI-powered trip planning.
                </p>

                {/* Email Form */}
                <EmailSubscribe variant="dark" source="cta" />

                <p className="mt-6 text-sm text-white/50">
                  No spam. Unsubscribe anytime. We respect your inbox.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
