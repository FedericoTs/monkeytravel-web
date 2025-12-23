"use client";

import { useState, useEffect, useRef, memo } from "react";
import type { Activity, VoteType, ActivityVote, ConsensusResult, ActivityVotingStatus } from "@/types";
import PlaceGallery from "../PlaceGallery";
import VotingSection from "../collaboration/VotingSection";
import {
  convertPriceLevelToRange,
  formatEstimatedPrice,
  type VerifiedPriceData,
} from "@/lib/utils/pricing";

interface EditableActivityCardProps {
  activity: Activity;
  index: number;
  currency?: string;
  showGallery?: boolean;
  isEditMode: boolean;
  onDelete: () => void;
  onUpdate: (updates: Partial<Activity>) => void;
  onMoveToDay: (dayIndex: number) => void;
  onRegenerate: () => void;
  availableDays: number[];
  currentDayIndex: number;
  isRegenerating?: boolean;
  /**
   * When true, photos will NOT be fetched automatically.
   * User can still trigger fetch via "Load Photos" button.
   * Used for saved trips to prevent automatic API costs.
   */
  disableAutoFetch?: boolean;
  /**
   * Callback fired when a Places API photo is captured.
   * Use this to persist the photo URL to the activity.
   */
  onPhotoCapture?: (activityId: string, photoUrl: string) => void;
  // Voting props (optional - only passed when collaboration is enabled)
  votingEnabled?: boolean;
  votes?: ActivityVote[];
  consensus?: ConsensusResult | null;
  activityStatus?: ActivityVotingStatus;
  currentUserVote?: VoteType | null;
  canVote?: boolean;
  totalVoters?: number;
  onVote?: (voteType: VoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
}

function EditableActivityCard({
  activity,
  index,
  currency = "USD",
  showGallery = true,
  isEditMode,
  onDelete,
  onUpdate,
  onMoveToDay,
  onRegenerate,
  availableDays,
  currentDayIndex,
  isRegenerating = false,
  disableAutoFetch = false,
  onPhotoCapture,
  // Voting props
  votingEnabled = false,
  votes = [],
  consensus = null,
  activityStatus = "confirmed",
  currentUserVote = null,
  canVote = false,
  totalVoters = 0,
  onVote,
  onRemoveVote,
}: EditableActivityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMoveToDay, setShowMoveToDay] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    start_time: activity.start_time,
    duration_minutes: activity.duration_minutes,
    name: activity.name,
    description: activity.description,
  });
  const [verifiedPrice, setVerifiedPrice] = useState<VerifiedPriceData | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  // Handle photo capture from PlaceGallery
  const handlePhotoCapture = (photoUrl: string) => {
    if (activity.id && onPhotoCapture) {
      onPhotoCapture(activity.id, photoUrl);
    }
  };

  // Use stable activity key to track what we've fetched (survives re-renders but not remounts)
  const fetchedActivityRef = useRef<string>("");

  // Create stable key from activity properties (not id, since we want to fetch for same place)
  const activityKey = `${activity.name}|${activity.address || activity.location}|${activity.type}`;

  // Types that typically have price information in Google Places
  const priceableTypes = [
    "restaurant", "attraction", "food", "cafe", "bar", "foodie",
    "market", "shopping", "cultural", "museum", "landmark",
    "spa", "wellness", "entertainment", "nightlife", "wine bar"
  ];

  // DISABLED: Price verification via Google Places API
  // This was causing $0.032 per activity card = massive costs
  // Each page view with 15 activities = $0.48
  // TODO: Re-enable with proper caching (localStorage + server cache) or lazy-load on "More" click
  //
  // useEffect(() => {
  //   if (!priceableTypes.includes(activity.type)) return;
  //   if (fetchedActivityRef.current === activityKey) return;
  //
  //   const fetchVerifiedPrice = async () => {
  //     fetchedActivityRef.current = activityKey;
  //     setPriceLoading(true);
  //     try {
  //       const response = await fetch("/api/places", {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({
  //           query: `${activity.name} ${activity.address || activity.location}`,
  //           maxPhotos: 1,
  //         }),
  //       });
  //       if (response.ok) {
  //         const data = await response.json();
  //         if (data.priceRange || data.priceLevel !== undefined || data.priceLevelSymbol) {
  //           setVerifiedPrice({
  //             priceRange: data.priceRange,
  //             priceLevel: data.priceLevel,
  //             priceLevelSymbol: data.priceLevelSymbol,
  //             priceLevelLabel: data.priceLevelLabel,
  //           });
  //         }
  //       }
  //     } catch (error) {
  //       console.error("Failed to fetch verified price:", error);
  //     } finally {
  //       setPriceLoading(false);
  //     }
  //   };
  //   fetchVerifiedPrice();
  // }, [activityKey, activity.name, activity.address, activity.location, activity.type]);

  // Always show AI estimate instead - no API call needed
  useEffect(() => {
    setPriceLoading(false);
  }, []);

  // Generate URLs
  const mapSearchQuery = encodeURIComponent(
    `${activity.name} ${activity.address || activity.location}`
  );
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapSearchQuery}`;
  const googleSearchUrl = `https://www.google.com/search?q=${mapSearchQuery}`;

  const typeColors: Record<string, { bg: string; text: string; border: string }> = {
    // Food & Drink
    restaurant: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    food: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    cafe: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    bar: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
    foodie: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    "wine bar": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
    // Attractions & Culture
    attraction: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    cultural: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
    museum: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
    landmark: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    // Activities & Nature
    activity: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
    nature: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    park: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    // Shopping & Entertainment
    shopping: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
    market: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
    entertainment: { bg: "bg-fuchsia-50", text: "text-fuchsia-700", border: "border-fuchsia-200" },
    nightlife: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
    // Wellness
    spa: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
    wellness: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
    // Transport & Other
    transport: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
    event: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  };

  const colors = typeColors[activity.type] || { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" };

  const handleSaveEdit = () => {
    onUpdate({
      start_time: editValues.start_time,
      duration_minutes: editValues.duration_minutes,
      name: editValues.name,
      description: editValues.description,
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValues({
      start_time: activity.start_time,
      duration_minutes: activity.duration_minutes,
      name: activity.name,
      description: activity.description,
    });
    setIsEditing(false);
  };

  // Regenerating skeleton
  if (isRegenerating) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm animate-pulse">
        <div className="p-4">
          <div className="flex gap-4">
            <div className="hidden sm:flex flex-col w-16">
              <div className="h-6 bg-slate-200 rounded w-12 mx-auto" />
              <div className="h-4 bg-slate-200 rounded w-10 mx-auto mt-2" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="h-6 bg-slate-200 rounded w-3/4" />
              <div className="h-4 bg-slate-200 rounded w-full" />
              <div className="h-4 bg-slate-200 rounded w-2/3" />
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 px-4 py-2 bg-amber-50">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Regenerating activity with AI...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white border transition-all duration-300 relative ${
        expanded ? "shadow-lg border-slate-300" : "shadow-sm border-slate-200 hover:shadow-md"
      } ${isEditMode
          ? "rounded-r-xl rounded-l-none border-l-0" // Integrate with drag handle
          : "rounded-xl"
      }`}
    >
      {/* Edit Mode Actions Bar - Top of card */}
      {isEditMode && !isEditing && (
        <div className="absolute -top-2 -right-2 flex items-center gap-1 z-10">
          {/* Move to Day */}
          <div className="relative">
            <button
              onClick={() => setShowMoveToDay(!showMoveToDay)}
              className="w-8 h-8 rounded-full bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center shadow-lg transition-all"
              title="Move to day"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>

            {showMoveToDay && (
              <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 min-w-[120px]">
                {availableDays.map((dayNum) => (
                  <button
                    key={dayNum}
                    onClick={() => {
                      onMoveToDay(dayNum - 1);
                      setShowMoveToDay(false);
                    }}
                    disabled={dayNum - 1 === currentDayIndex}
                    className={`w-full px-3 py-1.5 text-sm text-left ${
                      dayNum - 1 === currentDayIndex
                        ? "text-slate-400 cursor-not-allowed bg-slate-50"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Day {dayNum}
                    {dayNum - 1 === currentDayIndex && " (current)"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Edit */}
          <button
            onClick={() => setIsEditing(true)}
            className="w-8 h-8 rounded-full bg-white hover:bg-blue-50 text-blue-600 flex items-center justify-center shadow-lg transition-all"
            title="Edit activity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Regenerate */}
          <button
            onClick={onRegenerate}
            className="w-8 h-8 rounded-full bg-white hover:bg-purple-50 text-purple-600 flex items-center justify-center shadow-lg transition-all"
            title="Regenerate with AI"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-8 h-8 rounded-full bg-white hover:bg-red-50 text-red-500 flex items-center justify-center shadow-lg transition-all"
            title="Delete activity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-white/95 rounded-xl z-20 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-500 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h4 className="font-semibold text-slate-900 mb-1">Delete Activity?</h4>
            <p className="text-sm text-slate-600 mb-4">"{activity.name}" will be removed from your itinerary.</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete();
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Thumbnail - matches ActivityCard design */}
      {activity.image_url && (
        <div className={`relative h-32 sm:h-40 w-full overflow-hidden ${
          isEditMode ? "rounded-tr-xl" : "rounded-t-xl"
        }`}>
          <img
            src={activity.image_url}
            alt={activity.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          <div className="absolute bottom-2 left-2">
            <span className={`text-xs px-2 py-1 rounded-full backdrop-blur-sm bg-white/90 ${colors.text} border ${colors.border}`}>
              {activity.type}
            </span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="p-3 sm:p-4">
        <div className="flex gap-3 sm:gap-4">
          {/* Time Column - hidden on mobile */}
          <div className="hidden sm:flex flex-shrink-0 text-center w-16 flex-col">
            {isEditing ? (
              <input
                type="time"
                value={editValues.start_time}
                onChange={(e) => setEditValues({ ...editValues, start_time: e.target.value })}
                className="w-full text-sm border border-slate-200 rounded px-1 py-1"
              />
            ) : (
              <div className="text-lg font-semibold text-slate-900">
                {activity.start_time}
              </div>
            )}
            {isEditing ? (
              <input
                type="number"
                value={editValues.duration_minutes}
                onChange={(e) => setEditValues({ ...editValues, duration_minutes: parseInt(e.target.value) || 0 })}
                className="w-full text-xs border border-slate-200 rounded px-1 py-1 mt-1"
                min="15"
                step="15"
              />
            ) : (
              <div className="text-xs text-slate-500">
                {activity.duration_minutes} min
              </div>
            )}
            <div
              className={`mt-2 w-8 h-8 mx-auto rounded-full ${colors.bg} ${colors.text} flex items-center justify-center`}
            >
              {activity.type === "restaurant" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h7a1 1 0 100-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM15 8a1 1 0 10-2 0v5.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L15 13.586V8z" />
                </svg>
              )}
              {activity.type === "attraction" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                </svg>
              )}
              {activity.type === "activity" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              )}
              {activity.type === "transport" && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                  <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
                </svg>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Mobile time/type indicator */}
            <div className="flex sm:hidden items-center gap-2 mb-2 text-sm">
              <div
                className={`w-6 h-6 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center flex-shrink-0`}
              >
                {activity.type === "restaurant" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h7a1 1 0 100-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM15 8a1 1 0 10-2 0v5.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L15 13.586V8z" />
                  </svg>
                )}
                {activity.type === "attraction" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                  </svg>
                )}
                {activity.type === "activity" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                )}
                {activity.type === "transport" && (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                    <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
                  </svg>
                )}
              </div>
              {isEditing ? (
                <>
                  <input
                    type="time"
                    value={editValues.start_time}
                    onChange={(e) => setEditValues({ ...editValues, start_time: e.target.value })}
                    className="text-sm border border-slate-200 rounded px-2 py-1 w-24"
                  />
                  <span className="text-slate-400">·</span>
                  <input
                    type="number"
                    value={editValues.duration_minutes}
                    onChange={(e) => setEditValues({ ...editValues, duration_minutes: parseInt(e.target.value) || 0 })}
                    className="text-sm border border-slate-200 rounded px-2 py-1 w-16"
                    min="15"
                    step="15"
                  />
                  <span className="text-slate-500 text-xs">min</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-slate-900">{activity.start_time}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{activity.duration_minutes} min</span>
                </>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editValues.name}
                      onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                      className="font-semibold text-slate-900 text-base sm:text-lg border border-slate-200 rounded px-2 py-1 w-full"
                    />
                  ) : (
                    <h4 className="font-semibold text-slate-900 text-base sm:text-lg">
                      {activity.name}
                    </h4>
                  )}
                  {!isEditing && (
                    <>
                      <span
                        className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} ${colors.border} border`}
                      >
                        {activity.type}
                      </span>
                      {activity.booking_required && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          Booking
                        </span>
                      )}
                    </>
                  )}
                </div>

                {isEditing ? (
                  <textarea
                    value={editValues.description}
                    onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                    className="text-slate-600 mt-1 text-sm border border-slate-200 rounded px-2 py-1 w-full resize-none"
                    rows={2}
                  />
                ) : (
                  <p className="text-slate-600 mt-1 text-sm line-clamp-2">
                    {activity.description}
                  </p>
                )}

                {/* Location */}
                <div className="flex items-start gap-2 mt-2 text-sm text-slate-500">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="line-clamp-1">{activity.address || activity.location}</span>
                </div>
              </div>

              {/* Price */}
              {!isEditing && (
                <div className="sm:text-right flex-shrink-0 mt-1 sm:mt-0">
                  {priceLoading ? (
                    <div className="h-6 w-16 bg-slate-100 rounded animate-pulse" />
                  ) : verifiedPrice?.priceRange ? (
                    // Show verified Google price range when available (e.g., "EUR 40-50")
                    <>
                      <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                        {verifiedPrice.priceRange}
                      </div>
                      <div className="text-[10px] text-green-600 hidden sm:flex items-center gap-1 justify-end">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Google verified
                      </div>
                    </>
                  ) : verifiedPrice?.priceLevel !== undefined ? (
                    // Convert price level to estimated range (don't show $$ symbols)
                    (() => {
                      const priceCurrency = activity.estimated_cost?.currency || currency;
                      const range = convertPriceLevelToRange(verifiedPrice.priceLevel, activity.type, priceCurrency);
                      const displayPrice = range
                        ? formatEstimatedPrice(range.min, range.max, priceCurrency)
                        : `${priceCurrency} ${activity.estimated_cost?.amount || 0}`;
                      return (
                        <>
                          <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                            <span className="text-slate-400 font-normal text-xs sm:text-sm">~</span>
                            {displayPrice}
                          </div>
                          <div className="text-[10px] text-blue-600 hidden sm:flex items-center gap-1 justify-end" title={`Based on ${verifiedPrice.priceLevelLabel} venue tier`}>
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            Venue tier estimate
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    // Fallback to AI estimate
                    <>
                      <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                        <span className="text-slate-400 font-normal text-xs sm:text-sm">~</span>
                        {activity.estimated_cost.amount === 0
                          ? "Free"
                          : `${activity.estimated_cost.currency || currency} ${activity.estimated_cost.amount}`}
                      </div>
                      <div className="text-[10px] text-slate-400 hidden sm:block">AI estimate</div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Edit Mode Save/Cancel buttons */}
            {isEditing && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-[var(--primary)] hover:bg-[var(--primary)]/90 rounded-lg transition-colors"
                >
                  Save Changes
                </button>
              </div>
            )}

            {/* Quick Actions */}
            {!isEditing && (
              <div className="flex flex-wrap gap-2 mt-3">
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                  </svg>
                  Maps
                </a>
                <a
                  href={googleSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                  </svg>
                  Verify
                </a>
                {activity.official_website && (
                  <a
                    href={activity.official_website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] text-xs font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Website
                  </a>
                )}
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors ml-auto"
                >
                  {expanded ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      Less
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      More
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Voting Section (only when collaboration is enabled and not editing) */}
            {votingEnabled && !isEditing && onVote && onRemoveVote && (
              <VotingSection
                activityId={activity.id || `activity-${index}`}
                votes={votes}
                consensus={consensus}
                status={activityStatus}
                currentUserVote={currentUserVote}
                canVote={canVote}
                totalVoters={totalVoters}
                onVote={onVote}
                onRemoveVote={onRemoveVote}
                className="mt-3"
              />
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && !isEditing && (
        <div className="border-t border-slate-100 p-3 sm:p-4 bg-slate-50/50 overflow-hidden">
          {/* Photo Gallery */}
          {showGallery && (
            <div className="mb-4 overflow-hidden max-w-full">
              <PlaceGallery
                placeName={activity.name}
                placeAddress={activity.address || activity.location}
                maxPhotos={5}
                showRating={true}
                disableAutoFetch={disableAutoFetch}
                onFirstPhotoFetched={handlePhotoCapture}
                existingImageUrl={activity.image_url}
              />
            </div>
          )}

          {/* Tips */}
          {activity.tips && activity.tips.length > 0 && (
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                Insider Tips
              </div>
              <ul className="space-y-1">
                {activity.tips.map((tip, i) => (
                  <li key={i} className="text-sm text-blue-700 flex items-start gap-2">
                    <span className="text-blue-400 mt-1">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Memoize to prevent re-renders during editing, especially during drag operations
// Only re-render when activity data or edit state changes
export default memo(EditableActivityCard, (prevProps, nextProps) => {
  // Quick identity checks
  if (prevProps.activity.id !== nextProps.activity.id) return false;
  if (prevProps.index !== nextProps.index) return false;
  if (prevProps.isEditMode !== nextProps.isEditMode) return false;
  if (prevProps.isRegenerating !== nextProps.isRegenerating) return false;
  if (prevProps.currentDayIndex !== nextProps.currentDayIndex) return false;
  if (prevProps.currency !== nextProps.currency) return false;

  // Check key activity properties that affect rendering
  const prev = prevProps.activity;
  const next = nextProps.activity;
  if (prev.name !== next.name) return false;
  if (prev.start_time !== next.start_time) return false;
  if (prev.duration_minutes !== next.duration_minutes) return false;
  if (prev.image_url !== next.image_url) return false;
  if (prev.type !== next.type) return false;
  if (prev.description !== next.description) return false;

  // Voting props
  if (prevProps.votingEnabled !== nextProps.votingEnabled) return false;
  if (prevProps.currentUserVote !== nextProps.currentUserVote) return false;
  if (prevProps.activityStatus !== nextProps.activityStatus) return false;
  if (prevProps.votes?.length !== nextProps.votes?.length) return false;
  if (prevProps.totalVoters !== nextProps.totalVoters) return false;

  return true;
});
