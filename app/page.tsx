import Navbar from '@/components/Navbar';
import PhoneMockup from '@/components/PhoneMockup';
import EmailSubscribe from '@/components/EmailSubscribe';
import Footer from '@/components/Footer';
import Link from 'next/link';

/* ============================================================================
   APP SCREENSHOTS CONFIGURATION
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

                {/* Main Headline */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--foreground)] leading-[1.08] tracking-tight mb-6">
                  Your Next Trip,
                  <br />
                  <span className="gradient-text-blue">Planned in 30 Seconds</span>
                </h1>

                {/* Sub-headline with value proposition */}
                <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                  MonkeyTravel's AI creates <span className="text-[var(--foreground)] font-medium">complete day-by-day itineraries</span> with
                  restaurants, attractions, and hidden gems — personalized to your style and budget.
                </p>

                {/* Primary CTAs */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-8">
                  <Link
                    href="/auth/signup"
                    className="group relative px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30 flex items-center justify-center gap-2"
                  >
                    <span>Start Planning — It's Free</span>
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
                <div className="text-sm text-[var(--foreground-muted)]">Average planning time</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">100+</div>
                <div className="text-sm text-[var(--foreground-muted)]">Destinations worldwide</div>
              </div>
              <div className="hidden sm:block w-px h-12 bg-gray-200" />
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-[var(--primary)]">3</div>
                <div className="text-sm text-[var(--foreground-muted)]">Budget tiers per trip</div>
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
                Trip planning is <span className="text-[var(--error)]">exhausting</span>
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                47 browser tabs. 3 spreadsheets. Hours of research.
                There's a better way.
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
                  title: 'Hours Wasted',
                  description: 'Endless scrolling through reviews, blogs, and forums trying to find reliable recommendations.',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  title: 'Decision Paralysis',
                  description: 'Too many options with no clear guidance. Which restaurant? What time? Which neighborhood?',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  ),
                  title: 'Generic Results',
                  description: 'Cookie-cutter itineraries that ignore your travel style, budget, and what actually matters to you.',
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
                Powered by AI
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                Smart travel planning that{' '}
                <span className="gradient-text">actually works</span>
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                Tell us where you're going. Our AI handles the rest — complete itineraries
                with activities, restaurants, and timing, ready in seconds.
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
                  title: 'Instant Itineraries',
                  description: 'Get a complete day-by-day travel plan in under 30 seconds. No more hours of research.',
                  color: 'bg-amber-50 text-amber-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                  title: '3 Budget Options',
                  description: 'Every trip includes Budget, Balanced, and Premium versions. Same destination, your price point.',
                  color: 'bg-emerald-50 text-emerald-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ),
                  title: 'Day-by-Day Schedule',
                  description: 'Morning, afternoon, evening — perfectly timed activities with realistic durations.',
                  color: 'bg-blue-50 text-blue-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  ),
                  title: 'Fully Customizable',
                  description: 'Edit any activity, swap restaurants, adjust timing. Your trip, your rules.',
                  color: 'bg-violet-50 text-violet-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  ),
                  title: 'Share & Export',
                  description: 'Share trips with friends, export to PDF, or add to your calendar with one click.',
                  color: 'bg-rose-50 text-rose-500',
                },
                {
                  icon: (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  ),
                  title: 'Verified Info',
                  description: 'Real photos, actual ratings, and official websites. No guesswork.',
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
                How It Works
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                Three steps to your{' '}
                <span className="gradient-text-blue">perfect trip</span>
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {[
                {
                  step: '1',
                  title: 'Enter Your Destination',
                  description: 'Tell us where you want to go, your dates, and how many travelers. Takes 10 seconds.',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  ),
                },
                {
                  step: '2',
                  title: 'AI Creates Your Plan',
                  description: 'Our AI generates 3 complete itineraries with different budget levels in under 30 seconds.',
                  icon: (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  ),
                },
                {
                  step: '3',
                  title: 'Customize & Go',
                  description: 'Pick your favorite, tweak any details, then export or share. Your adventure awaits.',
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
                href="/auth/signup"
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
                  Start planning{' '}
                  <span className="gradient-text">right now</span>
                </h2>
                <p className="text-lg text-[var(--foreground-muted)] mb-10 leading-relaxed">
                  Our web app is fully functional and free to use today. Create an account
                  in seconds and start planning your next adventure. Mobile apps for iOS
                  and Android are coming soon.
                </p>

                <ul className="space-y-5 mb-10">
                  {[
                    { text: 'Full web app available now — 100% free', icon: '✓', highlight: true },
                    { text: 'Complete day-by-day itineraries', icon: '📅' },
                    { text: 'Real photos and verified information', icon: '📷' },
                    { text: 'Export to PDF or calendar', icon: '📤' },
                    { text: 'iOS & Android apps coming soon', icon: '📱' },
                  ].map((item, index) => (
                    <li key={index} className={`flex items-center gap-4 ${item.highlight ? 'p-3 -mx-3 rounded-xl bg-emerald-50 border border-emerald-100' : ''}`}>
                      <span className={`text-xl ${item.highlight ? 'text-emerald-500' : ''}`}>{item.icon}</span>
                      <span className={`font-medium ${item.highlight ? 'text-emerald-700' : 'text-[var(--foreground)]'}`}>{item.text}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/auth/signup"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30"
                >
                  Create Free Account
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
              {[
                {
                  q: 'Is MonkeyTravel really free?',
                  a: 'Yes! The web app is completely free to use. Create an account, plan unlimited trips, and export your itineraries — all at no cost. We may introduce premium features in the future, but the core experience will always be free.',
                },
                {
                  q: 'Do I need to download an app?',
                  a: 'No download needed! MonkeyTravel works entirely in your web browser on any device. Our iOS and Android apps are currently in development and will launch soon for an even better mobile experience.',
                },
                {
                  q: 'How does the AI create itineraries?',
                  a: 'We use Google\'s Gemini AI to analyze your destination, dates, and preferences. It creates realistic day-by-day schedules with properly timed activities, local restaurants, and attractions — all verified with real data from Google Places.',
                },
                {
                  q: 'Can I customize the itinerary?',
                  a: 'Absolutely! Every activity can be edited, moved, or removed. You can also use our AI assistant to regenerate specific activities or ask for alternatives. It\'s your trip — make it perfect.',
                },
                {
                  q: 'What destinations do you support?',
                  a: 'MonkeyTravel works for destinations worldwide — from major cities like Paris and Tokyo to hidden gems. If Google has data on it, we can plan it.',
                },
                {
                  q: 'How do I share my trip with others?',
                  a: 'Click the share button on any trip to generate a shareable link. Anyone with the link can view your complete itinerary. You can also export to PDF for offline access.',
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
                  Free & Ready to Use
                </div>

                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight">
                  Your next adventure starts here
                </h2>
                <p className="text-lg sm:text-xl text-white/70 mb-10 max-w-2xl mx-auto leading-relaxed">
                  Stop spending hours planning. Create your free account and let AI do the work.
                  Your perfect itinerary is 30 seconds away.
                </p>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                  <Link
                    href="/auth/signup"
                    className="group px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all flex items-center justify-center gap-2"
                  >
                    <span>Start Planning Free</span>
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
                    Want updates on new features & mobile app launch?
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
