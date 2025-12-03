"use client";

import { useState, useMemo } from "react";

interface TripPackingEssentialsProps {
  items: string[];
  destination: string;
  className?: string;
}

// Category configuration with icons and styling
const CATEGORIES = {
  clothing: {
    label: "Wardrobe",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
    gradient: "from-rose-500/20 via-pink-500/10 to-transparent",
    accent: "rose",
    keywords: ["jacket", "coat", "shirt", "pants", "dress", "sweater", "shoes", "boots", "sandals", "socks", "underwear", "hat", "scarf", "gloves", "swimsuit", "swimwear", "layers", "clothing", "wear", "attire", "outfit", "shorts", "jeans", "t-shirt", "hoodie"],
  },
  electronics: {
    label: "Tech & Gear",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    ),
    gradient: "from-blue-500/20 via-indigo-500/10 to-transparent",
    accent: "blue",
    keywords: ["camera", "charger", "phone", "laptop", "adapter", "converter", "battery", "power bank", "headphone", "earphone", "cable", "tripod", "drone", "tablet"],
  },
  documents: {
    label: "Documents",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
      </svg>
    ),
    gradient: "from-amber-500/20 via-yellow-500/10 to-transparent",
    accent: "amber",
    keywords: ["passport", "visa", "id", "ticket", "insurance", "document", "reservation", "confirmation", "copy", "license", "itinerary", "booking"],
  },
  health: {
    label: "Health & Care",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    ),
    gradient: "from-emerald-500/20 via-teal-500/10 to-transparent",
    accent: "emerald",
    keywords: ["sunscreen", "medication", "medicine", "first aid", "toiletries", "toothbrush", "shampoo", "hand sanitizer", "mask", "sanitizer", "lotion", "sunglasses", "moisturizer", "vitamins", "prescription"],
  },
  accessories: {
    label: "Accessories",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
    gradient: "from-violet-500/20 via-purple-500/10 to-transparent",
    accent: "violet",
    keywords: ["umbrella", "bag", "backpack", "daypack", "luggage", "suitcase", "lock", "water bottle", "bottle", "rain", "gear", "wallet", "watch", "jewelry", "belt"],
  },
  other: {
    label: "Essentials",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    ),
    gradient: "from-slate-500/20 via-slate-400/10 to-transparent",
    accent: "slate",
    keywords: [],
  },
};

type CategoryKey = keyof typeof CATEGORIES;

// Categorize item based on keywords
function categorizeItem(item: string): CategoryKey {
  const lowerItem = item.toLowerCase();

  for (const [key, config] of Object.entries(CATEGORIES)) {
    if (key === "other") continue;
    if (config.keywords.some((keyword) => lowerItem.includes(keyword))) {
      return key as CategoryKey;
    }
  }
  return "other";
}

// Accent color classes for different categories
const accentClasses: Record<string, { check: string; ring: string; text: string; bg: string }> = {
  rose: { check: "bg-rose-500", ring: "ring-rose-500", text: "text-rose-600", bg: "bg-rose-50" },
  blue: { check: "bg-blue-500", ring: "ring-blue-500", text: "text-blue-600", bg: "bg-blue-50" },
  amber: { check: "bg-amber-500", ring: "ring-amber-500", text: "text-amber-600", bg: "bg-amber-50" },
  emerald: { check: "bg-emerald-500", ring: "ring-emerald-500", text: "text-emerald-600", bg: "bg-emerald-50" },
  violet: { check: "bg-violet-500", ring: "ring-violet-500", text: "text-violet-600", bg: "bg-violet-50" },
  slate: { check: "bg-slate-500", ring: "ring-slate-500", text: "text-slate-600", bg: "bg-slate-50" },
};

export default function TripPackingEssentials({
  items,
  destination,
  className = "",
}: TripPackingEssentialsProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["clothing", "documents"]));

  // Group items by category
  const categorizedItems = useMemo(() => {
    const grouped: Record<CategoryKey, string[]> = {
      clothing: [],
      electronics: [],
      documents: [],
      health: [],
      accessories: [],
      other: [],
    };

    items.forEach((item) => {
      const category = categorizeItem(item);
      grouped[category].push(item);
    });

    // Return only non-empty categories, sorted by item count
    return Object.entries(grouped)
      .filter(([, categoryItems]) => categoryItems.length > 0)
      .sort((a, b) => b[1].length - a[1].length) as [CategoryKey, string[]][];
  }, [items]);

  if (!items || items.length === 0) {
    return null;
  }

  const toggleItem = (item: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(item)) {
      newChecked.delete(item);
    } else {
      newChecked.add(item);
    }
    setCheckedItems(newChecked);
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const progress = Math.round((checkedItems.size / items.length) * 100);
  const packedCount = checkedItems.size;

  return (
    <section className={`mt-12 mb-8 ${className}`}>
      {/* Header with travel-inspired design */}
      <div className="relative overflow-hidden rounded-t-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 sm:p-8">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-[var(--accent)]/20 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-[var(--primary)]/20 to-transparent rounded-full blur-2xl translate-y-1/2 -translate-x-1/4" />

        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left - Title and subtitle */}
          <div className="flex items-center gap-4">
            {/* Luggage icon with animated accent */}
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--accent)] to-amber-500 flex items-center justify-center shadow-lg shadow-[var(--accent)]/30">
                <svg className="w-7 h-7 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              {/* Pulsing dot when items are packed */}
              {packedCount > 0 && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center animate-pulse">
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Journey Essentials
              </h3>
              <p className="text-slate-400 text-sm mt-0.5">
                Pack smart for {destination}
              </p>
            </div>
          </div>

          {/* Right - Progress indicator */}
          <div className="flex items-center gap-4 bg-white/5 backdrop-blur-sm rounded-2xl px-5 py-3 border border-white/10">
            {/* Circular progress */}
            <div className="relative w-12 h-12">
              <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 48 48">
                {/* Background circle */}
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="transparent"
                  className="text-white/10"
                />
                {/* Progress circle */}
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="transparent"
                  strokeDasharray={`${2 * Math.PI * 20}`}
                  strokeDashoffset={`${2 * Math.PI * 20 * (1 - progress / 100)}`}
                  className="text-[var(--accent)] transition-all duration-700 ease-out"
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                {progress}%
              </span>
            </div>

            <div className="text-right">
              <div className="text-2xl font-bold text-white tabular-nums">
                {packedCount}<span className="text-slate-500 font-normal">/{items.length}</span>
              </div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">
                Items Packed
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Categories list */}
      <div className="bg-white rounded-b-3xl border border-t-0 border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
        {categorizedItems.map(([category, categoryItems], catIdx) => {
          const config = CATEGORIES[category];
          const accent = accentClasses[config.accent];
          const isExpanded = expandedCategories.has(category);
          const categoryChecked = categoryItems.filter((item) => checkedItems.has(item)).length;
          const categoryProgress = Math.round((categoryChecked / categoryItems.length) * 100);

          return (
            <div
              key={category}
              className={catIdx > 0 ? "border-t border-slate-100" : ""}
            >
              {/* Category header - clickable to expand */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full px-5 sm:px-6 py-4 flex items-center gap-4 hover:bg-slate-50/80 transition-colors group"
              >
                {/* Category icon */}
                <div className={`relative w-10 h-10 rounded-xl ${accent.bg} flex items-center justify-center ${accent.text} transition-transform group-hover:scale-105`}>
                  {config.icon}
                  {/* Gradient overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${config.gradient} rounded-xl`} />
                </div>

                {/* Category info */}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-slate-900">{config.label}</h4>
                    <span className="text-xs text-slate-400">
                      {categoryChecked}/{categoryItems.length}
                    </span>
                  </div>
                  {/* Mini progress bar */}
                  <div className="mt-1.5 h-1 w-24 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${accent.check} transition-all duration-500 ease-out rounded-full`}
                      style={{ width: `${categoryProgress}%` }}
                    />
                  </div>
                </div>

                {/* Expand/collapse icon */}
                <svg
                  className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Items list - collapsible */}
              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isExpanded ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="px-5 sm:px-6 pb-4 pt-1 grid gap-1">
                  {categoryItems.map((item, idx) => {
                    const isChecked = checkedItems.has(item);
                    return (
                      <label
                        key={idx}
                        className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200 ${
                          isChecked
                            ? "bg-slate-50"
                            : "hover:bg-slate-50/60"
                        }`}
                      >
                        {/* Custom checkbox */}
                        <div
                          className={`relative w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-300 ${
                            isChecked
                              ? `${accent.check} border-transparent scale-110`
                              : `border-slate-300 group-hover:border-slate-400 group-hover:scale-105`
                          }`}
                          onClick={(e) => {
                            e.preventDefault();
                            toggleItem(item);
                          }}
                        >
                          <svg
                            className={`w-3 h-3 text-white transition-all duration-200 ${
                              isChecked ? "opacity-100 scale-100" : "opacity-0 scale-50"
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>

                        {/* Item text */}
                        <span
                          className={`flex-1 text-sm transition-all duration-300 ${
                            isChecked
                              ? "text-slate-400 line-through decoration-slate-300"
                              : "text-slate-700 group-hover:text-slate-900"
                          }`}
                        >
                          {item}
                        </span>

                        {/* Subtle check indicator on the right */}
                        {isChecked && (
                          <span className={`text-xs font-medium ${accent.text} opacity-60`}>
                            Packed
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {/* Footer with tips */}
        <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-slate-50 to-slate-50/50 border-t border-slate-100">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <svg className="w-4 h-4 text-[var(--accent)] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <p>
              Tap items to mark them as packed. Your progress is saved locally.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
