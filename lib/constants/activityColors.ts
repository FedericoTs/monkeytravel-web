/**
 * Activity Type Colors
 *
 * Shared color definitions for activity type badges.
 * Used by: ActivityCard, EditableActivityCard, ActivityDetailSheet
 */

import { activityTypeKey } from "@/lib/i18n/activity-type";

export interface ActivityTypeColor {
  bg: string;
  text: string;
  border: string;
  icon: string;
}

/**
 * Color mapping for all activity types
 */
export const ACTIVITY_TYPE_COLORS: Record<string, ActivityTypeColor> = {
  // Food & Drink
  restaurant: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", icon: "🍽️" },
  food: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", icon: "🍽️" },
  cafe: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", icon: "☕" },
  bar: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", icon: "🍷" },
  foodie: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", icon: "🍜" },
  wineBar: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", icon: "🍷" },

  // Attractions & Culture
  attraction: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: "📍" },
  cultural: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", icon: "🏛️" },
  museum: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", icon: "🏛️" },
  landmark: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: "🗽" },
  sightseeing: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: "📷" },
  tour: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: "🗺️" },
  urban: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: "🏙️" },

  // Activities & Nature
  activity: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", icon: "🎯" },
  nature: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: "🌳" },
  park: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: "🌳" },
  adventure: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", icon: "🧗" },
  beach: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: "🏖️" },

  // Shopping & Entertainment
  shopping: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200", icon: "🛍️" },
  market: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200", icon: "🏪" },
  entertainment: { bg: "bg-fuchsia-50", text: "text-fuchsia-700", border: "border-fuchsia-200", icon: "🎭" },
  nightlife: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", icon: "🌃" },
  romantic: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", icon: "🌹" },

  // Wellness
  spa: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", icon: "💆" },
  wellness: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", icon: "🧘" },

  // Transport & Other
  transport: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", icon: "🚌" },
  accommodation: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", icon: "🏨" },
  event: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200", icon: "🎉" },
};

/**
 * Default colors for unknown activity types
 */
export const DEFAULT_ACTIVITY_COLOR: ActivityTypeColor = {
  bg: "bg-slate-50",
  text: "text-slate-700",
  border: "border-slate-200",
  icon: "📍",
};

/**
 * Get colors for an activity type, read through the same normalizer as its label
 * ("food_market" gets the market colors). Falls back to default colors if type is unknown
 */
export function getActivityTypeColors(type: string | undefined): ActivityTypeColor {
  const key = activityTypeKey(type);
  return (key && ACTIVITY_TYPE_COLORS[key]) || DEFAULT_ACTIVITY_COLOR;
}
