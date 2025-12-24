"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface TripPackingListProps {
  items: string[];
  className?: string;
}

// Categorize packing items intelligently
function categorizeItem(item: string): string {
  const lowerItem = item.toLowerCase();

  // Clothing
  if (
    lowerItem.includes("jacket") ||
    lowerItem.includes("coat") ||
    lowerItem.includes("shirt") ||
    lowerItem.includes("pants") ||
    lowerItem.includes("dress") ||
    lowerItem.includes("sweater") ||
    lowerItem.includes("shoes") ||
    lowerItem.includes("boots") ||
    lowerItem.includes("sandals") ||
    lowerItem.includes("socks") ||
    lowerItem.includes("underwear") ||
    lowerItem.includes("hat") ||
    lowerItem.includes("scarf") ||
    lowerItem.includes("gloves") ||
    lowerItem.includes("swimsuit") ||
    lowerItem.includes("swimwear") ||
    lowerItem.includes("layers") ||
    lowerItem.includes("clothing") ||
    lowerItem.includes("wear") ||
    lowerItem.includes("attire") ||
    lowerItem.includes("outfit")
  ) {
    return "clothing";
  }

  // Electronics
  if (
    lowerItem.includes("camera") ||
    lowerItem.includes("charger") ||
    lowerItem.includes("phone") ||
    lowerItem.includes("laptop") ||
    lowerItem.includes("adapter") ||
    lowerItem.includes("converter") ||
    lowerItem.includes("battery") ||
    lowerItem.includes("power bank") ||
    lowerItem.includes("headphone") ||
    lowerItem.includes("earphone")
  ) {
    return "electronics";
  }

  // Documents
  if (
    lowerItem.includes("passport") ||
    lowerItem.includes("visa") ||
    lowerItem.includes("id") ||
    lowerItem.includes("ticket") ||
    lowerItem.includes("insurance") ||
    lowerItem.includes("document") ||
    lowerItem.includes("reservation") ||
    lowerItem.includes("confirmation") ||
    lowerItem.includes("copy") ||
    lowerItem.includes("license")
  ) {
    return "documents";
  }

  // Health & Toiletries
  if (
    lowerItem.includes("sunscreen") ||
    lowerItem.includes("medication") ||
    lowerItem.includes("medicine") ||
    lowerItem.includes("first aid") ||
    lowerItem.includes("toiletries") ||
    lowerItem.includes("toothbrush") ||
    lowerItem.includes("shampoo") ||
    lowerItem.includes("hand sanitizer") ||
    lowerItem.includes("mask") ||
    lowerItem.includes("sanitizer") ||
    lowerItem.includes("lotion") ||
    lowerItem.includes("sunglasses") ||
    lowerItem.includes("moisturizer")
  ) {
    return "health";
  }

  // Accessories & Gear
  if (
    lowerItem.includes("umbrella") ||
    lowerItem.includes("bag") ||
    lowerItem.includes("backpack") ||
    lowerItem.includes("daypack") ||
    lowerItem.includes("luggage") ||
    lowerItem.includes("suitcase") ||
    lowerItem.includes("lock") ||
    lowerItem.includes("water bottle") ||
    lowerItem.includes("bottle") ||
    lowerItem.includes("rain") ||
    lowerItem.includes("gear")
  ) {
    return "accessories";
  }

  return "other";
}

// Category icons and colors
const categoryConfig: Record<string, { icon: React.ReactNode; color: string; key: string }> = {
  clothing: {
    key: "clothing",
    color: "text-rose-500 bg-rose-50 border-rose-200",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  electronics: {
    key: "electronics",
    color: "text-blue-500 bg-blue-50 border-blue-200",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  documents: {
    key: "documents",
    color: "text-amber-600 bg-amber-50 border-amber-200",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  health: {
    key: "health",
    color: "text-emerald-500 bg-emerald-50 border-emerald-200",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  accessories: {
    key: "accessories",
    color: "text-violet-500 bg-violet-50 border-violet-200",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    ),
  },
  other: {
    key: "other",
    color: "text-slate-500 bg-slate-50 border-slate-200",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    ),
  },
};

export default function TripPackingList({ items, className = "" }: TripPackingListProps) {
  const t = useTranslations("common.packing");
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(false);

  if (!items || items.length === 0) {
    return null;
  }

  // Group items by category
  const categorizedItems = items.reduce<Record<string, string[]>>((acc, item) => {
    const category = categorizeItem(item);
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  // Sort categories by number of items
  const sortedCategories = Object.entries(categorizedItems).sort((a, b) => b[1].length - a[1].length);

  const toggleItem = (item: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(item)) {
      newChecked.delete(item);
    } else {
      newChecked.add(item);
    }
    setCheckedItems(newChecked);
  };

  const progress = (checkedItems.size / items.length) * 100;
  const displayedCategories = isExpanded ? sortedCategories : sortedCategories.slice(0, 3);

  return (
    <div className={`mb-8 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t("title")}</h2>
            <p className="text-xs text-slate-500">{t("packed", { checked: checkedItems.size, total: items.length })}</p>
          </div>
        </div>

        {/* Progress Ring */}
        <div className="relative w-12 h-12">
          <svg className="w-12 h-12 transform -rotate-90">
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              className="text-slate-100"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              strokeDasharray={`${2 * Math.PI * 20}`}
              strokeDashoffset={`${2 * Math.PI * 20 * (1 - progress / 100)}`}
              className="text-emerald-500 transition-all duration-500"
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-700">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* Categorized Items */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {displayedCategories.map(([category, categoryItems], catIdx) => {
          const config = categoryConfig[category];
          return (
            <div
              key={category}
              className={`${catIdx > 0 ? "border-t border-slate-100" : ""}`}
            >
              {/* Category Header */}
              <div className={`px-4 py-2.5 ${config.color} flex items-center gap-2 border-b border-slate-100`}>
                {config.icon}
                <span className="text-sm font-medium">{t(`categories.${config.key}`)}</span>
                <span className="ml-auto text-xs opacity-60">{t("items", { count: categoryItems.length })}</span>
              </div>

              {/* Items */}
              <div className="divide-y divide-slate-50">
                {categoryItems.map((item, idx) => {
                  const isChecked = checkedItems.has(item);
                  return (
                    <label
                      key={idx}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          isChecked
                            ? "bg-emerald-500 border-emerald-500"
                            : "border-slate-300 group-hover:border-emerald-400"
                        }`}
                        onClick={(e) => {
                          e.preventDefault();
                          toggleItem(item);
                        }}
                      >
                        {isChecked && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span
                        className={`text-sm transition-all ${
                          isChecked ? "text-slate-400 line-through" : "text-slate-700"
                        }`}
                      >
                        {item}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Show More/Less */}
      {sortedCategories.length > 3 && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-3 w-full py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isExpanded ? (
            <>
              {t("showLess")}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </>
          ) : (
            <>
              {t("showMoreCategories", { count: sortedCategories.length - 3 })}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </button>
      )}
    </div>
  );
}
