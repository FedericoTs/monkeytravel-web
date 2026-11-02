"use client";

import { useState, useMemo, useEffect } from "react";
import { Link } from "@/lib/i18n/routing";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useActivityTypeLabel } from "@/lib/i18n/activity-type";
import type { ItineraryDay, TripMeta } from "@/types";
import { trackTemplateBrowsed } from "@/lib/analytics";
import DestinationHero from "@/components/DestinationHero";
import ActivityCard from "@/components/ActivityCard";
import TripPackingEssentials from "@/components/trip/TripPackingEssentials";
import DaySlider from "@/components/ui/DaySlider";
import TravelConnector from "@/components/trip/TravelConnector";
import DaySummary from "@/components/trip/DaySummary";
import { DayTimeline } from "@/components/trip/DayTimeline";
import { MapToggle, ViewModeToggle } from "@/components/trip/ViewControls";
import SaveTripModal from "@/components/ui/SaveTripModal";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import { useTravelDistances } from "@/hooks/useTravelDistances";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { useCurrency } from "@/lib/locale";
import { dayBudgetLabel, showsDayBudget } from "@/lib/trip/day-budget";
import DayHeader, { DayBudget } from "@/components/trip/DayHeader";
import {
  Sparkles,
  Copy,
  Map,
  MapPinOff,
  LayoutGrid,
  List,
  Users,
  Clock,
  Wallet,
  Check
} from "lucide-react";

// Dynamic import for TripMap
// Loading fallback text is intentionally left untranslated — it's a brief
// chunk-load flash and useTranslations cannot run at module scope.
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-500" />
    </div>
  ),
});

// Mood tag emoji mapping — labels resolved via t() at render time so they
// stay locale-aware. Keep keys in sync with messages/{locale}/trips.json → template.moods.
const MOOD_EMOJI: Record<string, string> = {
  romantic: "💕",
  adventure: "🏔️",
  cultural: "🏛️",
  relaxation: "🌴",
  foodie: "🍝",
  family: "👨‍👩‍👧‍👦",
};

interface TemplatePreviewClientProps {
  template: {
    id: string;
    title: string;
    description: string;
    fullDescription?: string;
    destination: string;
    country: string;
    countryCode: string;
    coverImageUrl?: string;
    durationDays: number;
    budgetTier: string;
    moodTags: string[];
    tags: string[];
    copyCount: number;
    itinerary: ItineraryDay[];
    meta?: TripMeta;
    budget?: { total: number; currency: string };
    packingList: string[];
  };
}

export default function TemplatePreviewClient({ template }: TemplatePreviewClientProps) {
  const t = useTranslations('trips.template');
  const typeLabel = useActivityTypeLabel();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Track template view for discovery analytics
  useEffect(() => {
    trackTemplateBrowsed({
      templateId: template.id,
      templateName: template.title,
    });
  }, [template.id, template.title]);

  // Currency conversion hook
  const { convert: convertCurrency, format: formatCurrency } = useCurrency();

  const formatDayBudget = (day: ItineraryDay): string =>
    dayBudgetLabel(day, { convert: convertCurrency, format: formatCurrency }, t('price.free'), template.budget?.currency || "EUR");

  // Memoize ensureActivityIds
  const displayItinerary = useMemo(
    () => ensureActivityIds(template.itinerary),
    [template.itinerary]
  );

  // Fetch travel distances (local calculation, no API)
  const { travelData, isLoading: travelLoading } = useTravelDistances(displayItinerary);

  // Calculate total activities
  const activitiesCount = useMemo(
    () => displayItinerary.reduce((acc, day) => acc + day.activities.length, 0),
    [displayItinerary]
  );

  // Map budget tier key to localized label; fall back to "moderate" for unknown tiers.
  const budgetTierKey =
    template.budgetTier === "budget" || template.budgetTier === "luxury"
      ? template.budgetTier
      : "moderate";
  const budgetLabel = t(`budgetTier.${budgetTierKey}`);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Hero */}
      <DestinationHero
        destination={template.destination}
        title={template.title}
        subtitle={template.fullDescription || template.description}
        budget={template.budget || undefined}
        days={template.durationDays}
        nights={template.durationDays - 1}
        activitiesCount={activitiesCount}
        weatherNote={template.meta?.weather_note}
        highlights={template.meta?.highlights}
        tags={template.tags}
        showBackButton={true}
        onBack={() => window.history.back()}
        disableApiCalls={true}
        coverImageUrl={template.coverImageUrl}
      >
        {/* Template Badge */}
        <div className="absolute top-4 right-4">
          <span className="px-3 py-1.5 rounded-full text-sm font-medium shadow-lg bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/80 text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            {t('curatedEscape')}
          </span>
        </div>
      </DestinationHero>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Template Info Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Duration */}
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-slate-500" />
              <span className="font-medium text-slate-700">{t('durationDays', { count: template.durationDays })}</span>
            </div>

            {/* Budget Tier */}
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-slate-500" />
              <span className="font-medium text-slate-700">{budgetLabel}</span>
            </div>

            {/* Copy Count */}
            {template.copyCount > 0 && (
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-slate-500" />
                <span className="font-medium text-slate-700">
                  {t('travelersUsed', { count: template.copyCount })}
                </span>
              </div>
            )}
          </div>

          {/* Mood Tags */}
          <div className="flex flex-wrap gap-2">
            {template.moodTags.map((mood) => {
              const emoji = MOOD_EMOJI[mood];
              // Known mood keys resolve via t(); unknown moods fall back to the raw tag.
              const label = emoji ? t(`moods.${mood}`) : mood;
              return (
                <span
                  key={mood}
                  className="px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700"
                >
                  {emoji ? `${emoji} ` : ''}{label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-6">
          {/* Left side - Back */}
          <div className="flex items-center gap-2">
            <Link
              href="/trips"
              rel="nofollow"
              className="flex items-center gap-1 sm:gap-2 text-slate-600 hover:text-slate-900 px-2 sm:px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">{t('backToTrips')}</span>
            </Link>
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ViewModeToggle
              value={viewMode}
              onChange={setViewMode}
              labels={{ cards: t('cards'), timeline: t('timeline') }}
              icons={{ cards: <LayoutGrid className="w-4 h-4" />, timeline: <List className="w-4 h-4" /> }}
            />
            <MapToggle
              shown={showMap}
              onToggle={() => setShowMap(!showMap)}
              labels={{ show: t('showMap'), hide: t('hideMap') }}
              icon={showMap ? <MapPinOff className="w-5 h-5 sm:w-4 sm:h-4" /> : <Map className="w-5 h-5 sm:w-4 sm:h-4" />}
            />
          </div>
        </div>

        {/* Interactive Map */}
        {showMap && displayItinerary.length > 0 && (
          <div className="mb-8">
            <TripMap
              days={displayItinerary}
              destination={template.destination}
              selectedDay={selectedDay}
              className="h-[400px]"
              disableApiCalls={true}
            />
          </div>
        )}

        {/* Day Filter Slider */}
        <DaySlider
          days={displayItinerary}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          className="mb-6"
        />

        {/* Itinerary */}
        {displayItinerary.length > 0 ? (
          <div className="space-y-8">
            {displayItinerary
              .filter((day) => selectedDay === null || day.day_number === selectedDay)
              .map((day) => (
                <div key={day.day_number}>
                  <DayHeader
                    dayNumber={day.day_number}
                    title={day.title || t('dayFallback', { number: day.day_number })}
                    theme={day.theme}
                  >
                    {showsDayBudget(day) && <DayBudget label={t('estBudget')} value={formatDayBudget(day)} />}
                  </DayHeader>

                  {/* Activities */}
                  {viewMode === "cards" ? (
                    <>
                      <div className="grid gap-0">
                        {day.activities.map((activity, idx) => {
                          const nextActivity = day.activities[idx + 1];
                          const dayTravelData = travelData.get(day.day_number);
                          const segment = nextActivity && dayTravelData?.segments.find(
                            (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                          );

                          return (
                            <div key={activity.id || idx}>
                              <ActivityCard
                                activity={activity}
                                index={idx}
                                currency={template.budget?.currency}
                                showGallery={true}
                                disableAutoFetch={true}
                              />
                              {/* Travel connector */}
                              {idx < day.activities.length - 1 && (
                                <TravelConnector
                                  distanceMeters={segment?.distanceMeters}
                                  durationSeconds={segment?.durationSeconds}
                                  distanceText={segment?.distanceText}
                                  durationText={segment?.durationText}
                                  mode={segment?.mode}
                                  isLoading={travelLoading || dayTravelData?.isLoading}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Day travel + feasibility summary */}
                      <DaySummary
                        dayNumber={day.day_number}
                        segments={travelData.get(day.day_number)?.segments ?? []}
                        activities={day.activities}
                        pace={template.meta?.pace}
                        className="mt-4"
                      />
                    </>
                  ) : (
                    /* Timeline View */
                    <DayTimeline
                      day={day}
                      travel={travelData.get(day.day_number)}
                      travelLoading={travelLoading}
                      pace={template.meta?.pace}
                      typeLabel={typeLabel}
                      currency={template.budget?.currency || "EUR"}
                    />
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="text-lg font-medium text-slate-900 mb-2">{t('noItineraryTitle')}</h3>
            <p className="text-slate-600">{t('noItineraryMessage')}</p>
          </div>
        )}

        {/* Packing List */}
        {template.packingList && template.packingList.length > 0 && (
          <TripPackingEssentials
            items={template.packingList}
            destination={template.destination}
          />
        )}

        {/* Info Notice */}
        <div className="mt-12 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-blue-900 mb-1">
                {t('curatedTitle')}
              </h4>
              <p className="text-sm text-blue-800">
                {t('curatedDescription')}
              </p>
            </div>
          </div>
        </div>

        {/* Floating Save CTA - positioned above mobile nav */}
        <div className="fixed bottom-20 sm:bottom-0 left-0 right-0 z-40 p-4 bg-gradient-to-t from-white via-white to-white/80 border-t border-slate-200 sm:pb-safe">
          <div className="max-w-xl mx-auto">
            {/* Main CTA Card */}
            <div className="bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/90 rounded-xl shadow-xl p-4">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                {/* Value Proposition */}
                <div className="flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                    <span className="text-white/80 text-sm font-medium">
                      {t('loveThisItinerary')}
                    </span>
                  </div>
                  <p className="text-white text-xs opacity-80">
                    {t('saveAndSetDates')}
                  </p>
                </div>

                {/* CTA Button */}
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold text-base bg-white text-[var(--primary-ink)] hover:bg-white/90 hover:shadow-lg active:scale-[0.98] transition-all min-w-[180px]"
                >
                  <Copy className="w-5 h-5" />
                  <span>{t('saveToMyTrips')}</span>
                </button>
              </div>
            </div>

            {/* Trust badges */}
            <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                {t('trustBadges.freeForever')}
              </span>
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                {t('trustBadges.fullyEditable')}
              </span>
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                {t('trustBadges.shareWithFriends')}
              </span>
            </div>
          </div>
        </div>

        {/* Spacer for fixed CTA + mobile nav */}
        <div className="h-56 sm:h-32" />
      </main>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/images/logo.png"
                alt="MonkeyTravel Logo"
                width={28}
                height={28}
                className="w-7 h-7 object-contain"
              />
              <span className="font-semibold text-slate-900">MonkeyTravel</span>
            </Link>
            <p className="text-sm text-slate-500">
              {t('footer.tagline')}
            </p>
            <Link
              href="/trips/new"
              className="text-sm text-[var(--primary-ink)] hover:underline font-medium"
            >
              {t('footer.createOwnTrip')}
            </Link>
          </div>
        </div>
      </footer>

      {/* Save Trip Modal */}
      <SaveTripModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        templateId={template.id}
        tripTitle={template.title}
        tripDestination={template.destination}
        tripCountryCode={template.countryCode}
        durationDays={template.durationDays}
      />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="trips" />
    </div>
  );
}
