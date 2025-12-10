"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Check, Sparkles } from "lucide-react";

interface PersonalizationStepProps {
  // Travel styles
  travelStyles: string[];
  onTravelStylesChange: (styles: string[]) => void;
  // Dietary
  dietaryPreferences: string[];
  onDietaryChange: (prefs: string[]) => void;
  // Accessibility
  accessibilityNeeds: string[];
  onAccessibilityChange: (needs: string[]) => void;
  // Active hours
  activeHoursStart: number;
  activeHoursEnd: number;
  onActiveHoursStartChange: (hour: number) => void;
  onActiveHoursEndChange: (hour: number) => void;
  // Destination context
  destination?: string;
}

// Travel styles data
const TRAVEL_STYLES = [
  { id: "adventure", label: "Adventure", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "cultural", label: "Culture", icon: "M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" },
  { id: "foodie", label: "Foodie", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { id: "relaxation", label: "Wellness", icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" },
  { id: "nightlife", label: "Nightlife", icon: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" },
  { id: "photography", label: "Photography", icon: "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z" },
];

// Dietary data
const DIETARY_OPTIONS = [
  { id: "none", label: "No restrictions" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "halal", label: "Halal" },
  { id: "kosher", label: "Kosher" },
  { id: "gluten-free", label: "Gluten-free" },
];

// Accessibility data
const ACCESSIBILITY_OPTIONS = [
  { id: "none", label: "No needs" },
  { id: "wheelchair", label: "Wheelchair accessible" },
  { id: "limited-mobility", label: "Limited mobility" },
  { id: "visual", label: "Visual assistance" },
  { id: "hearing", label: "Hearing assistance" },
  { id: "rest-stops", label: "Frequent rest stops" },
];

// Active hours presets
const HOUR_PRESETS = [
  { label: "Early Bird", start: 6, end: 20, time: "6 AM - 8 PM" },
  { label: "Standard", start: 8, end: 22, time: "8 AM - 10 PM" },
  { label: "Night Owl", start: 10, end: 24, time: "10 AM - 12 AM" },
];

const formatHour = (hour: number): string => {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
};

interface SectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string;
}

function AccordionSection({ title, subtitle, icon, isOpen, onToggle, children, badge }: SectionProps) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center gap-3 bg-white hover:bg-slate-50 transition-colors"
      >
        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
          {icon}
        </div>
        <div className="flex-1 text-left">
          <div className="font-medium text-slate-900 flex items-center gap-2">
            {title}
            {badge && (
              <span className="text-xs px-2 py-0.5 bg-[var(--primary)]/10 text-[var(--primary)] rounded-full">
                {badge}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-500">{subtitle}</div>
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-2 bg-slate-50 border-t border-slate-100">
          {children}
        </div>
      )}
    </div>
  );
}

export default function PersonalizationStep({
  travelStyles,
  onTravelStylesChange,
  dietaryPreferences,
  onDietaryChange,
  accessibilityNeeds,
  onAccessibilityChange,
  activeHoursStart,
  activeHoursEnd,
  onActiveHoursStartChange,
  onActiveHoursEndChange,
  destination,
}: PersonalizationStepProps) {
  // Track which section is open (only one at a time for cleaner UX)
  const [openSection, setOpenSection] = useState<string | null>("travel");

  const toggleStyle = (styleId: string) => {
    if (travelStyles.includes(styleId)) {
      onTravelStylesChange(travelStyles.filter((s) => s !== styleId));
    } else {
      onTravelStylesChange([...travelStyles, styleId]);
    }
  };

  const toggleDietary = (dietId: string) => {
    if (dietId === "none") {
      onDietaryChange(dietaryPreferences.includes("none") ? [] : ["none"]);
      return;
    }
    const withoutNone = dietaryPreferences.filter((s) => s !== "none");
    if (dietaryPreferences.includes(dietId)) {
      onDietaryChange(withoutNone.filter((s) => s !== dietId));
    } else {
      onDietaryChange([...withoutNone, dietId]);
    }
  };

  const toggleAccessibility = (needId: string) => {
    if (needId === "none") {
      onAccessibilityChange(accessibilityNeeds.includes("none") ? [] : ["none"]);
      return;
    }
    const withoutNone = accessibilityNeeds.filter((s) => s !== "none");
    if (accessibilityNeeds.includes(needId)) {
      onAccessibilityChange(withoutNone.filter((s) => s !== needId));
    } else {
      onAccessibilityChange([...withoutNone, needId]);
    }
  };

  const applyHourPreset = (start: number, end: number) => {
    onActiveHoursStartChange(start);
    onActiveHoursEndChange(end);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-[var(--primary)]/10 rounded-xl">
            <Sparkles className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Personalize your trip</h1>
        </div>
        <p className="text-slate-600">
          {destination
            ? `Help us create a perfect itinerary for ${destination}`
            : "Help us create the perfect itinerary for you"}
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm text-amber-800">
            <span className="font-medium">Only travel style is required.</span> Other preferences are optional and help us suggest better restaurants and activities.
          </p>
        </div>
      </div>

      {/* Accordion sections */}
      <div className="space-y-3">
        {/* Travel Style - Required */}
        <AccordionSection
          title="Travel style"
          subtitle={travelStyles.length > 0 ? `${travelStyles.length} selected` : "Select at least one"}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          isOpen={openSection === "travel"}
          onToggle={() => setOpenSection(openSection === "travel" ? null : "travel")}
          badge="Required"
        >
          <div className="grid grid-cols-3 gap-2">
            {TRAVEL_STYLES.map((style) => {
              const isSelected = travelStyles.includes(style.id);
              return (
                <button
                  key={style.id}
                  onClick={() => toggleStyle(style.id)}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    isSelected
                      ? "border-[var(--primary)] bg-white shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div
                    className={`w-8 h-8 mx-auto rounded-lg flex items-center justify-center mb-2 ${
                      isSelected ? "bg-[var(--primary)] text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.icon} />
                    </svg>
                  </div>
                  <div className="text-xs font-medium text-slate-700 text-center">{style.label}</div>
                </button>
              );
            })}
          </div>
        </AccordionSection>

        {/* Dietary - Optional */}
        <AccordionSection
          title="Dietary preferences"
          subtitle={
            dietaryPreferences.length > 0
              ? dietaryPreferences.includes("none")
                ? "No restrictions"
                : `${dietaryPreferences.length} selected`
              : "Optional"
          }
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          }
          isOpen={openSection === "dietary"}
          onToggle={() => setOpenSection(openSection === "dietary" ? null : "dietary")}
        >
          <div className="flex flex-wrap gap-2">
            {DIETARY_OPTIONS.map((diet) => {
              const isSelected = dietaryPreferences.includes(diet.id);
              return (
                <button
                  key={diet.id}
                  onClick={() => toggleDietary(diet.id)}
                  className={`px-3 py-2 rounded-lg border-2 text-sm transition-all flex items-center gap-2 ${
                    isSelected
                      ? "border-[var(--primary)] bg-white text-slate-900"
                      : "border-slate-200 bg-white hover:border-slate-300 text-slate-600"
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-[var(--primary)]" />}
                  {diet.label}
                </button>
              );
            })}
          </div>
        </AccordionSection>

        {/* Accessibility - Optional */}
        <AccordionSection
          title="Accessibility needs"
          subtitle={
            accessibilityNeeds.length > 0
              ? accessibilityNeeds.includes("none")
                ? "No specific needs"
                : `${accessibilityNeeds.length} selected`
              : "Optional"
          }
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          }
          isOpen={openSection === "accessibility"}
          onToggle={() => setOpenSection(openSection === "accessibility" ? null : "accessibility")}
        >
          <div className="flex flex-wrap gap-2">
            {ACCESSIBILITY_OPTIONS.map((option) => {
              const isSelected = accessibilityNeeds.includes(option.id);
              return (
                <button
                  key={option.id}
                  onClick={() => toggleAccessibility(option.id)}
                  className={`px-3 py-2 rounded-lg border-2 text-sm transition-all flex items-center gap-2 ${
                    isSelected
                      ? "border-[var(--primary)] bg-white text-slate-900"
                      : "border-slate-200 bg-white hover:border-slate-300 text-slate-600"
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-[var(--primary)]" />}
                  {option.label}
                </button>
              );
            })}
          </div>
        </AccordionSection>

        {/* Active Hours - Optional */}
        <AccordionSection
          title="Active hours"
          subtitle={`${formatHour(activeHoursStart)} - ${formatHour(activeHoursEnd)}`}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
          isOpen={openSection === "hours"}
          onToggle={() => setOpenSection(openSection === "hours" ? null : "hours")}
        >
          <div className="space-y-4">
            {/* Presets */}
            <div className="grid grid-cols-3 gap-2">
              {HOUR_PRESETS.map((preset) => {
                const isSelected = activeHoursStart === preset.start && activeHoursEnd === preset.end;
                return (
                  <button
                    key={preset.label}
                    onClick={() => applyHourPreset(preset.start, preset.end)}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      isSelected
                        ? "border-[var(--primary)] bg-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="font-medium text-slate-900 text-sm">{preset.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{preset.time}</div>
                  </button>
                );
              })}
            </div>

            {/* Custom sliders */}
            <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
              <div className="text-xs text-slate-500 text-center">Custom schedule</div>
              <div>
                <div className="flex justify-between text-sm text-slate-600 mb-2">
                  <span>Start activities</span>
                  <span className="font-medium">{formatHour(activeHoursStart)}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={12}
                  value={activeHoursStart}
                  onChange={(e) => onActiveHoursStartChange(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                />
              </div>
              <div>
                <div className="flex justify-between text-sm text-slate-600 mb-2">
                  <span>Wind down by</span>
                  <span className="font-medium">{formatHour(activeHoursEnd)}</span>
                </div>
                <input
                  type="range"
                  min={18}
                  max={24}
                  value={activeHoursEnd}
                  onChange={(e) => onActiveHoursEndChange(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                />
              </div>
            </div>
          </div>
        </AccordionSection>
      </div>
    </div>
  );
}
