import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "@/lib/i18n/routing";
import {
  generateFAQSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";

/**
 * /backpacker landing page.
 *
 * Shipped 2026-05-28 as Phase B3 of the Backpacker Mode / Hostelworld
 * partnership wedge. Purpose:
 *   1. SEO surface for "backpacker trip planner / AI hostel itinerary /
 *      backpacker route europe" type queries.
 *   2. Cold-open asset — the URL we send to Hostelworld (and any other
 *      backpacker-adjacent partner) when starting a conversation. "Look
 *      at the product we built for your demographic."
 *   3. Single-purpose conversion funnel: every CTA lands on /trips/new
 *      where the Backpacker Mode toggle is one click away.
 *
 * Deliberately English-only (no i18n strings) to ship the cold-open
 * asset fast. Hostelworld is UK-based; English is the right primary
 * language for the partner pitch. Spanish/Italian translations are a
 * separate copy pass if the page proves out.
 */

const BASE_URL = "https://monkeytravel.app";
const PAGE_PATH = "/backpacker";

const META = {
  title: "Backpacker Trip Planner — AI Itineraries Built for Hostels & Budget Travel",
  description:
    "Plan a backpacker route in 30 seconds. Hostels-first accommodation, free walking tours, street food, public transit, social activities — AI that actually understands backpacker travel. 100% free, no signup needed.",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const prefix = locale === "en" ? "" : `/${locale}`;
  return {
    title: META.title,
    description: META.description,
    alternates: {
      canonical: `${BASE_URL}${prefix}${PAGE_PATH}`,
      languages: {
        en: `${BASE_URL}${PAGE_PATH}`,
        es: `${BASE_URL}/es${PAGE_PATH}`,
        it: `${BASE_URL}/it${PAGE_PATH}`,
        "x-default": `${BASE_URL}${PAGE_PATH}`,
      },
    },
    openGraph: {
      title: META.title,
      description: META.description,
      type: "website",
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: "MonkeyTravel — Backpacker Trip Planner",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: META.title,
      description: META.description,
      images: [`${BASE_URL}/og-image.png`],
    },
  };
}

const FAQ_ITEMS = [
  {
    question: "What makes a backpacker trip plan different?",
    answer:
      "Backpacker travel optimises for different things than a typical holiday: hostels instead of hotels, free walking tours over guided coaches, street food over fine dining, public transit and intercity buses over taxis, and social activities where solo travellers can meet others. Our AI accounts for all of this when Backpacker Mode is on, so the resulting itinerary actually looks like a backpacker trip — not a watered-down luxury plan.",
  },
  {
    question: "Is it really free? Where's the catch?",
    answer:
      "Yes, completely free. No signup needed to generate a plan — you only create an account if you want to save your trip and access it later from another device. We don't charge for the AI generation, the recommendations, or any of the features.",
  },
  {
    question: "How is this different from Hostelworld or Booking.com?",
    answer:
      "Hostelworld and Booking.com are amazing at letting you book a bed — but they don't help you plan the days in between. We do the opposite: we plan the entire trip (day-by-day itinerary, neighbourhood-by-neighbourhood) and then link out to Hostelworld for the actual hostel booking. Use both together.",
  },
  {
    question: "Will it suggest hostels in good neighbourhoods?",
    answer:
      "Yes. The AI knows which neighbourhoods are hostel-dense and backpacker-friendly in each major destination — Bairro Alto in Lisbon, El Born in Barcelona, Khao San in Bangkok, Friedrichshain in Berlin, and so on. It also factors in safety, public transit access, and proximity to social spots like pub crawls and night markets.",
  },
  {
    question: "Can I do a multi-city / overland route?",
    answer:
      "Absolutely. For 5+ day trips, the AI considers whether splitting between 2 (or more) cities would give you a better experience, and suggests overland options (FlixBus, BlaBlaCar, intercity trains) where they make sense.",
  },
  {
    question: "What if I want a slightly more comfortable plan?",
    answer:
      "Toggle Backpacker Mode off in the wizard and regenerate. You'll get a more mid-range plan with the same destination + dates. Or keep Backpacker Mode on but bump the budget tier in step 2 — the plan will still favour hostels and social activities, just with the occasional splurge.",
  },
];

const ROUTES = [
  { name: "Lisbon", neighbourhood: "Bairro Alto", days: "5", emoji: "🇵🇹" },
  { name: "Barcelona", neighbourhood: "El Born / El Raval", days: "5", emoji: "🇪🇸" },
  { name: "Berlin", neighbourhood: "Friedrichshain", days: "4", emoji: "🇩🇪" },
  { name: "Prague", neighbourhood: "Žižkov", days: "4", emoji: "🇨🇿" },
  { name: "Budapest", neighbourhood: "District VII", days: "4", emoji: "🇭🇺" },
  { name: "Athens", neighbourhood: "Plaka / Monastiraki", days: "4", emoji: "🇬🇷" },
  { name: "Bangkok", neighbourhood: "Khao San / Sukhumvit", days: "5", emoji: "🇹🇭" },
  { name: "Tokyo", neighbourhood: "Asakusa / Shibuya", days: "6", emoji: "🇯🇵" },
];

const FEATURES = [
  {
    color: "bg-emerald-50 text-emerald-600",
    icon: "🎒",
    title: "Hostels-first accommodation",
    body: "Suggests hostels and budget guesthouses in proven backpacker neighbourhoods. No 4-star hotel suggestions, no boutique places you can't afford.",
  },
  {
    color: "bg-amber-50 text-amber-600",
    icon: "🚶",
    title: "Free walking tours + viewpoints",
    body: "Free city walking tours, viewpoints, public parks, free museum days. Skips the €60 guided experiences unless they're genuinely worth it.",
  },
  {
    color: "bg-rose-50 text-rose-600",
    icon: "🍜",
    title: "Street food + markets",
    body: "Local markets, street food, casual cafeterias, hostel-kitchen-friendly grocery options. One splurge meal at most — local, not touristy.",
  },
  {
    color: "bg-blue-50 text-blue-600",
    icon: "🚆",
    title: "Public transit + intercity buses",
    body: "Walking, metro, intercity buses (FlixBus, BlaBlaCar). Mentions specific transit cards worth getting. No taxis unless safety dictates.",
  },
  {
    color: "bg-violet-50 text-violet-600",
    icon: "🍻",
    title: "Built-in social activities",
    body: "At least one explicitly social activity per day — pub crawl, walking tour, hostel-organised event, language exchange. Solo backpackers want to meet people.",
  },
  {
    color: "bg-cyan-50 text-cyan-600",
    icon: "🗺️",
    title: "Multi-city overland routes",
    body: "For 5+ day trips, the AI considers splitting between 2 cities with intercity transit suggestions. Backpacker classic — one trip, multiple stops.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Toggle 🎒 Backpacker mode",
    body: "Step 1 of the wizard. Pick the toggle, pick a destination, pick dates. That's it.",
  },
  {
    n: "2",
    title: "Generate in 30 seconds",
    body: "The AI builds a day-by-day plan optimised for backpacker travel — neighbourhoods, transit, food, social spots.",
  },
  {
    n: "3",
    title: "Book hostels in one tap",
    body: 'Every backpacker trip has a "Find hostels for this trip" button that opens Hostelworld pre-filtered to your destination + dates.',
  },
];

export default async function BackpackerLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const prefix = locale === "en" ? "" : `/${locale}`;

  const breadcrumbItems = [
    { name: "Home", url: `${BASE_URL}${prefix}` },
    { name: "Backpacker Trip Planner", url: `${BASE_URL}${prefix}${PAGE_PATH}` },
  ];

  return (
    <>
      <script
        {...jsonLdScriptProps([
          generateFAQSchema(FAQ_ITEMS),
          generateBreadcrumbSchema(breadcrumbItems),
        ])}
      />

      <Navbar />

      <main className="min-h-screen">
        {/* ============== HERO ============== */}
        <section className="relative min-h-[70vh] pt-20 pb-16 overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-amber-50">
          <div className="absolute top-32 left-[10%] w-72 h-72 bg-emerald-400/10 rounded-full blur-[100px]" />
          <div className="absolute top-64 right-[5%] w-96 h-96 bg-amber-400/10 rounded-full blur-[120px]" />

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-[55vh] text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-8">
              <span className="text-lg" aria-hidden>🎒</span>
              <span className="text-sm font-semibold text-emerald-700">
                Backpacker Mode is live
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.08] tracking-tight mb-6">
              An AI trip planner that actually understands{" "}
              <span className="text-emerald-600">backpacker travel</span>
            </h1>

            <p className="text-lg sm:text-xl text-slate-600 mb-10 max-w-2xl leading-relaxed">
              Hostels-first accommodation. Free walking tours. Street food. Public transit.
              Social activities where solo travellers actually meet people. Generated in 30 seconds,
              free forever.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link
                href="/trips/new"
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/30"
              >
                <span aria-hidden>🎒</span>
                <span>Plan a backpacker trip</span>
                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <a
                href="#routes"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 font-semibold rounded-xl hover:border-emerald-500 hover:text-emerald-700 transition-all"
              >
                See sample routes
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm text-slate-600">
              {["100% free", "No signup", "30-second generation"].map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============== FEATURES ============== */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                Built for how backpackers actually travel
              </h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Most AI trip planners default to mid-range tourist plans. Toggle Backpacker Mode
                and every line of the itinerary reorients around your demo — accommodation,
                activities, food, transit, social life.
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((f) => (
                <div key={f.title} className="p-6 rounded-2xl border border-slate-200 hover:shadow-md transition-shadow">
                  <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-4 text-2xl`} aria-hidden>
                    {f.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{f.title}</h3>
                  <p className="text-slate-600 leading-relaxed text-sm">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============== HOW IT WORKS ============== */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                How it works
              </h2>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {STEPS.map((step) => (
                <div key={step.n} className="bg-white rounded-2xl p-6 border border-slate-200 relative">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 text-white font-bold text-lg flex items-center justify-center mb-4">
                    {step.n}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{step.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============== SAMPLE ROUTES ============== */}
        <section id="routes" className="py-20 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                Try one of these classic backpacker destinations
              </h2>
              <p className="text-lg text-slate-600">
                One click pre-fills the wizard. The AI handles the rest.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {ROUTES.map((r) => (
                <Link
                  key={r.name}
                  href={"/trips/new" as never}
                  className="group p-5 rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-md bg-white transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl" aria-hidden>{r.emoji}</span>
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                      {r.days} days
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors">
                    {r.name}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Hostel zone: {r.neighbourhood}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ============== FAQ ============== */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                Frequently asked
              </h2>
            </div>
            <div className="space-y-3">
              {FAQ_ITEMS.map((item) => (
                <details key={item.question} className="group bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                    <span className="font-semibold text-slate-900 pr-4">{item.question}</span>
                    <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="px-5 pb-5 text-slate-600 leading-relaxed text-sm">
                    {item.answer}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ============== FINAL CTA ============== */}
        <section className="py-20 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-12 sm:p-16 text-center text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-[100px]" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-amber-400/30 rounded-full blur-[80px]" />
              <div className="relative">
                <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
                  Your next backpacker trip is 30 seconds away.
                </h2>
                <p className="text-lg text-emerald-50 mb-8 max-w-2xl mx-auto">
                  Pick a destination. Toggle Backpacker mode. Generate.
                  We&rsquo;ll handle the hostels and the FlixBus connections.
                </p>
                <Link
                  href="/trips/new"
                  className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-emerald-700 font-bold rounded-xl hover:bg-emerald-50 transition-all shadow-lg"
                >
                  <span aria-hidden>🎒</span>
                  Plan my backpacker trip
                  <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
