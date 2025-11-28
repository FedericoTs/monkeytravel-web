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
  // Hero section - main phone mockup
  hero: undefined as string | undefined,
  // Example: hero: '/screenshots/home-screen.png',

  // App Preview section - three phones showing different screens
  preview: {
    left: undefined as string | undefined,    // e.g., '/screenshots/discover.png'
    center: undefined as string | undefined,  // e.g., '/screenshots/itinerary.png'
    right: undefined as string | undefined,   // e.g., '/screenshots/trip-detail.png'
  },
};

const features = [
  {
    title: 'AI-Powered Planning',
    description: 'Gemini AI creates personalized day-by-day itineraries tailored to your travel style.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    span: 'col-span-1',
  },
  {
    title: 'Day-by-Day Itineraries',
    description: 'Detailed daily schedules with activities, restaurants, and experiences from morning to night.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    span: 'col-span-1',
  },
  {
    title: 'Swipe to Discover',
    description: 'Tinder-style preference learning. Swipe through destinations and our AI learns your travel personality.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
    span: 'col-span-1 md:col-span-2',
    featured: true,
  },
  {
    title: '3 Budget Options',
    description: 'Budget, Balanced, or Premium — same destinations, different experiences, your choice.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    span: 'col-span-1',
  },
  {
    title: 'Collaborate Together',
    description: 'Invite friends and family. Plan trips together in real-time with shared access.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    span: 'col-span-1',
  },
  {
    title: 'Smart Hotels',
    description: 'AI picks hotels based on your daily activities. Stay where you need to be.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    span: 'col-span-1',
  },
];

const steps = [
  {
    number: '01',
    title: 'Discover',
    description: 'Swipe through destinations. Our AI learns your travel style in minutes.',
  },
  {
    number: '02',
    title: 'Plan',
    description: 'Set your destination, dates, and budget preference.',
  },
  {
    number: '03',
    title: 'Generate',
    description: 'AI creates 3 complete itinerary options instantly.',
  },
  {
    number: '04',
    title: 'Explore',
    description: 'Review, customize, and get ready for adventure.',
  },
];

const faqs = [
  {
    q: 'When will MonkeyTravel be available?',
    a: 'We\'re in active development and launching soon. Join the waitlist for early access and updates.',
  },
  {
    q: 'Is it free to use?',
    a: 'MonkeyTravel will have a free tier with core features. Premium features available via subscription.',
  },
  {
    q: 'How does the AI work?',
    a: 'Our AI learns your preferences through swipe interactions, then generates personalized day-by-day itineraries with Budget, Balanced, and Premium options.',
  },
  {
    q: 'Can I plan with friends?',
    a: 'Yes! Collaborative planning lets you invite others to plan trips together in real-time.',
  },
];

export default function Home() {
  return (
    <>
      <Navbar />

      <main>
        {/* Hero Section - Warm & Inviting */}
        <section className="relative min-h-screen pt-24 pb-16 overflow-hidden gradient-warm bg-grid-pattern-light">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center text-center pt-8 lg:pt-16">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/20 text-[var(--primary-dark)] text-sm font-medium border border-[var(--accent)]/30 mb-8">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                Coming Soon — Join the Waitlist
              </div>

              {/* Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-[var(--foreground)] leading-[1.1] tracking-tight mb-6 max-w-4xl">
                Plan Your Perfect Trip with{' '}
                <span className="relative inline-block text-[var(--primary)]">
                  Effortless
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 12" fill="none" preserveAspectRatio="none">
                    <path d="M2 8C50 2 150 2 198 8" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                </span>
                {' '}AI
              </h1>

              {/* Subtitle */}
              <p className="text-lg sm:text-xl text-[var(--foreground-muted)] mb-10 max-w-2xl leading-relaxed">
                Stop spending hours researching. Our AI creates personalized day-by-day
                itineraries with Budget, Balanced, and Premium options — in minutes.
              </p>

              {/* Email Form */}
              <EmailSubscribe variant="hero" source="hero" className="mb-6" />

              {/* Trust indicators */}
              <p className="text-sm text-[var(--foreground-muted)] flex items-center gap-2 mb-12">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                No spam, ever. Unsubscribe anytime.
              </p>

              {/* Phone Mockup */}
              <div className="relative w-full flex justify-center">
                {/* Decorative elements */}
                <div className="absolute top-20 left-10 w-20 h-20 bg-[var(--accent)]/20 rounded-full blur-2xl" />
                <div className="absolute top-40 right-10 w-32 h-32 bg-[var(--primary)]/10 rounded-full blur-3xl" />

                <div className="animate-float">
                  <PhoneMockup scale="lg" screenImage={APP_SCREENSHOTS.hero} />
                </div>
              </div>
            </div>
          </div>

          {/* Bottom gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
        </section>

        {/* Value Props Section */}
        <section className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  stat: '3',
                  label: 'Budget Tiers',
                  desc: 'Same trip, your budget',
                },
                {
                  stat: 'AI',
                  label: 'Powered',
                  desc: 'Gemini generates itineraries',
                },
                {
                  stat: '24/7',
                  label: 'Planning',
                  desc: 'No more research burnout',
                },
              ].map((item, index) => (
                <div
                  key={index}
                  className="text-center p-8 rounded-3xl bg-[var(--background-alt)] border border-gray-100"
                >
                  <div className="text-4xl sm:text-5xl font-bold gradient-text-blue mb-2">{item.stat}</div>
                  <div className="text-lg font-semibold text-[var(--foreground)] mb-1">{item.label}</div>
                  <div className="text-[var(--foreground-muted)]">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features - Bento Grid */}
        <section id="features" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Section Header */}
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-medium mb-4">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                Features
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
                Everything you need to{' '}
                <span className="gradient-text-blue">travel smarter</span>
              </h2>
              <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
                Powered by advanced AI, designed for real travelers.
              </p>
            </div>

            {/* Bento Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className={`group p-6 rounded-2xl border border-gray-100 bg-white hover:border-[var(--accent)] hover:shadow-xl transition-all duration-300 card-hover ${feature.span} ${feature.featured ? 'bg-gradient-to-br from-[var(--primary)]/5 to-[var(--accent)]/5' : ''}`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors ${feature.featured ? 'bg-[var(--accent)] text-[var(--primary-dark)]' : 'bg-[var(--background-alt)] text-[var(--primary)] group-hover:bg-[var(--accent)] group-hover:text-[var(--primary-dark)]'}`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">{feature.title}</h3>
                  <p className="text-[var(--foreground-muted)] leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-24 bg-[var(--background-alt)] bg-grid-pattern-light">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Section Header */}
            <div className="text-center mb-20">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)]/10 text-[var(--primary-dark)] text-sm font-medium mb-4">
                How It Works
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
                Four steps to your{' '}
                <span className="gradient-text">perfect trip</span>
              </h2>
            </div>

            {/* Steps */}
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {steps.map((step, index) => (
                <div key={step.number} className="relative text-center">
                  {/* Connector line */}
                  {index < steps.length - 1 && (
                    <div className="hidden lg:block absolute top-10 left-[60%] w-full h-px bg-gradient-to-r from-[var(--accent)] to-transparent" />
                  )}

                  {/* Step number */}
                  <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6">
                    <div className="absolute inset-0 bg-[var(--accent)]/10 rounded-2xl rotate-6" />
                    <div className="absolute inset-0 bg-white rounded-2xl shadow-lg" />
                    <span className="relative text-2xl font-bold gradient-text">{step.number}</span>
                  </div>

                  <h3 className="text-xl font-bold text-[var(--foreground)] mb-2">{step.title}</h3>
                  <p className="text-[var(--foreground-muted)]">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* App Preview */}
        <section className="py-24 bg-white overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              {/* Left - Phones */}
              <div className="relative order-2 lg:order-1">
                <div className="relative flex justify-center">
                  {/* Background glow */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-r from-[var(--accent)]/10 to-[var(--primary)]/10 rounded-full blur-3xl" />

                  {/* Phone arrangement */}
                  <div className="relative">
                    <div className="absolute -left-12 top-12 scale-90 opacity-60 -rotate-12 hidden md:block">
                      <PhoneMockup scale="md" screenImage={APP_SCREENSHOTS.preview.left} />
                    </div>
                    <div className="relative z-10">
                      <PhoneMockup scale="lg" screenImage={APP_SCREENSHOTS.preview.center} />
                    </div>
                    <div className="absolute -right-12 top-12 scale-90 opacity-60 rotate-12 hidden md:block">
                      <PhoneMockup scale="md" screenImage={APP_SCREENSHOTS.preview.right} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right - Content */}
              <div className="order-1 lg:order-2">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-medium mb-6">
                  See It In Action
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-6 tracking-tight">
                  Your complete trip,{' '}
                  <span className="gradient-text-blue">beautifully organized</span>
                </h2>
                <p className="text-lg text-[var(--foreground-muted)] mb-8 leading-relaxed">
                  MonkeyTravel isn&apos;t just another travel app. It&apos;s your personal AI travel
                  planner that understands your style, respects your budget, and creates
                  adventures you&apos;ll actually want to take.
                </p>

                <ul className="space-y-4">
                  {[
                    'Swipe-based preference learning',
                    '3 budget tiers for every destination',
                    'Detailed day-by-day schedules',
                    'AI-selected hotels near activities',
                    'Real-time collaborative planning',
                  ].map((item, index) => (
                    <li key={index} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-[var(--primary-dark)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <span className="text-[var(--foreground)]">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="support" className="py-24 bg-[var(--background-alt)]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Section Header */}
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary)] text-sm font-medium mb-4">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                FAQ
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
                Questions? We&apos;ve got{' '}
                <span className="gradient-text-blue">answers</span>
              </h2>
            </div>

            {/* FAQ Items */}
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <details
                  key={index}
                  className="group bg-white rounded-2xl border border-gray-100 overflow-hidden"
                >
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                    <span className="font-semibold text-[var(--foreground)] pr-4">{faq.q}</span>
                    <div className="w-8 h-8 rounded-full bg-[var(--background-alt)] flex items-center justify-center flex-shrink-0 group-open:bg-[var(--accent)] transition-colors">
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
            <div className="mt-12 text-center p-8 bg-white rounded-2xl border border-gray-100">
              <p className="text-[var(--foreground-muted)] mb-4">
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
                <a
                  href="mailto:feedback@monkeytravel.app"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full border-2 border-gray-200 text-[var(--foreground)] font-medium hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                  Send Feedback
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section id="download" className="py-24 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl mesh-gradient p-12 sm:p-16 text-center">
              {/* Grid overlay */}
              <div className="absolute inset-0 bg-grid-pattern pointer-events-none" />

              {/* Content */}
              <div className="relative">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm font-medium text-white/80 mb-6">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                  Limited Early Access
                </div>

                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 tracking-tight">
                  Ready to transform how you plan travel?
                </h2>
                <p className="text-lg text-white/60 mb-10 max-w-2xl mx-auto">
                  Join the waitlist and be among the first to experience AI-powered trip planning.
                </p>

                {/* Email Form */}
                <EmailSubscribe variant="dark" source="cta" />
                <p className="mt-4 text-sm text-white/40">
                  No spam, ever. We respect your inbox.
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
