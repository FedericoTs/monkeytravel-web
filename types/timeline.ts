/**
 * Trip Timeline Types
 *
 * These types extend the core Trip and Activity types to support
 * the full trip lifecycle: pre-trip, active, and post-trip phases.
 */

// ============================================================================
// CORE ENUMS
// ============================================================================

export type TripPhase = "planning" | "pre_trip" | "active" | "completed";

export type ActivityStatus = "upcoming" | "in_progress" | "completed" | "skipped";

export type ChecklistCategory = "booking" | "packing" | "document" | "custom";

export type QuickTag = "must-do" | "crowded" | "worth-it" | "skip-next-time" | "hidden-gem" | "overrated";

// ============================================================================
// ACTIVITY TIMELINE
// ============================================================================

/**
 * Tracks the timeline state of a single activity during a trip
 */
export interface ActivityTimeline {
  activity_id: string;
  trip_id: string;
  user_id: string;

  // Status tracking
  status: ActivityStatus;
  started_at?: string; // ISO timestamp
  completed_at?: string;
  actual_duration_minutes?: number;

  // Rating and feedback
  rating?: 1 | 2 | 3 | 4 | 5;
  experience_notes?: string;
  quick_tags?: QuickTag[];

  // Metadata
  created_at: string;
  updated_at: string;
}

// ============================================================================
// ACTIVITY PHOTOS
// ============================================================================

/**
 * A photo captured during an activity
 */
export interface ActivityPhoto {
  id: string;
  trip_id: string;
  activity_id: string;
  user_id: string;

  // Photo data
  storage_path: string;
  url: string;
  thumbnail_url?: string;
  original_filename?: string;
  file_size_bytes?: number;
  mime_type?: string;

  // Metadata
  caption?: string;
  taken_at: string;
  is_favorite: boolean;

  // EXIF data (optional)
  exif_data?: {
    camera?: string;
    location?: { lat: number; lng: number };
    orientation?: number;
  };

  created_at: string;
}

/**
 * Request payload for uploading a photo
 */
export interface PhotoUploadRequest {
  tripId: string;
  activityId: string;
  caption?: string;
}

// ============================================================================
// CHECKLIST
// ============================================================================

/**
 * A checklist item for pre-trip preparation
 */
export interface ChecklistItem {
  id: string;
  trip_id: string;
  user_id: string;

  // Item data
  text: string;
  category: ChecklistCategory;
  is_checked: boolean;
  due_date?: string;
  sort_order: number;

  // If auto-generated from an activity with booking_required
  source_activity_id?: string;

  // Timestamps
  created_at: string;
  checked_at?: string;
}

/**
 * Request payload for creating a checklist item
 */
export interface CreateChecklistItemRequest {
  text: string;
  category?: ChecklistCategory;
  due_date?: string;
}

// ============================================================================
// TRIP STATS
// ============================================================================

/**
 * Aggregated statistics for a completed trip
 */
export interface TripStats {
  // Activity counts
  total_activities: number;
  completed_activities: number;
  skipped_activities: number;

  // Photos
  total_photos: number;
  favorite_photos: number;

  // Ratings
  average_rating: number | null;
  rated_activities: number;

  // Travel metrics
  total_walking_km: number;
  total_driving_km: number;
  total_travel_time_minutes: number;

  // Highlights
  favorite_activity_id?: string;
  most_photographed_activity_id?: string;
}

// ============================================================================
// WEATHER
// ============================================================================

/**
 * Weather forecast for a single day
 */
export interface DayWeather {
  date: string;
  temp_high: number;
  temp_low: number;
  condition: "sunny" | "cloudy" | "partly_cloudy" | "rain" | "storm" | "snow" | "fog";
  icon: string;
  precipitation_chance: number;
  humidity: number;
  wind_speed_kmh: number;
}

// ============================================================================
// TIMELINE STATE
// ============================================================================

/**
 * Complete timeline state for a trip
 * This is a denormalized view combining data from multiple tables
 */
export interface TimelineState {
  trip_id: string;
  phase: TripPhase;

  // Pre-trip
  days_until_start?: number;
  checklist: ChecklistItem[];
  checklist_progress: number; // 0-100

  // Active trip
  current_day?: number;
  total_days: number;
  current_activity_id?: string;
  current_activity_status?: ActivityStatus;

  // Progress
  day_progress: DayProgress[];

  // Activity timelines (keyed by activity_id)
  activity_timelines: Record<string, ActivityTimeline>;

  // Photos (keyed by activity_id)
  photos_by_activity: Record<string, ActivityPhoto[]>;

  // Post-trip
  stats?: TripStats;
  album_generated: boolean;
  highlight_photo_ids: string[];

  // Weather (pre-trip and during)
  weather_forecast?: DayWeather[];
}

/**
 * Progress summary for a single day
 */
export interface DayProgress {
  day_number: number;
  total_activities: number;
  completed_activities: number;
  skipped_activities: number;
  is_current: boolean;
  is_completed: boolean;
}

// ============================================================================
// API RESPONSES
// ============================================================================

/**
 * Response from GET /api/trips/[id]/timeline
 */
export interface TimelineResponse {
  timeline: TimelineState;
  trip: {
    id: string;
    title: string;
    start_date: string;
    end_date: string;
    status: string;
  };
}

/**
 * Response from POST /api/trips/[id]/activities/[activityId]/complete
 */
export interface CompleteActivityResponse {
  success: boolean;
  activity_timeline: ActivityTimeline;
  next_activity_id?: string;
  day_completed: boolean;
  trip_completed: boolean;
}

/**
 * Response from POST /api/trips/[id]/photos
 */
export interface PhotoUploadResponse {
  success: boolean;
  photo: ActivityPhoto;
}

// ============================================================================
// HOOKS TYPES
// ============================================================================

/**
 * Return type for useTimeline hook
 */
export interface UseTimelineReturn {
  timeline: TimelineState | null;
  isLoading: boolean;
  error: Error | null;

  // Actions
  startActivity: (activityId: string) => Promise<void>;
  completeActivity: (activityId: string, rating?: number, notes?: string) => Promise<void>;
  skipActivity: (activityId: string, reason?: string) => Promise<void>;
  rateActivity: (activityId: string, rating: number) => Promise<void>;

  // Checklist
  toggleChecklistItem: (itemId: string) => Promise<void>;
  addChecklistItem: (text: string, category?: ChecklistCategory) => Promise<void>;
  deleteChecklistItem: (itemId: string) => Promise<void>;

  // Photos
  uploadPhoto: (activityId: string, file: File, caption?: string) => Promise<ActivityPhoto>;
  deletePhoto: (photoId: string) => Promise<void>;
  togglePhotoFavorite: (photoId: string) => Promise<void>;

  // Refresh
  refresh: () => Promise<void>;
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

/**
 * Props for CountdownHero component
 */
export interface CountdownHeroProps {
  destination: string;
  startDate: Date;
  tripDays: number;
  activitiesCount: number;
  weatherForecast?: DayWeather;
  coverImageUrl?: string;
}

/**
 * Props for LiveActivityCard component
 */
export interface LiveActivityCardProps {
  activity: {
    id: string;
    name: string;
    description: string;
    start_time: string;
    duration_minutes: number;
    address?: string;
    location?: string;
    type: string;
  };
  status: ActivityStatus;
  rating?: number;
  onComplete: () => void;
  onSkip: () => void;
  onAddPhoto: () => void;
  onAddNote: () => void;
  onRate?: (rating: number) => void;
}

/**
 * Props for PreTripChecklist component
 */
export interface PreTripChecklistProps {
  items: ChecklistItem[];
  onToggle: (id: string) => void;
  onAdd: (text: string, category: ChecklistCategory) => void;
  onDelete: (id: string) => void;
}

/**
 * Props for PhotoAlbum component
 */
export interface PhotoAlbumProps {
  tripId: string;
  photos: ActivityPhoto[];
  groupByDay?: boolean;
  onPhotoClick?: (photo: ActivityPhoto) => void;
  onToggleFavorite?: (photoId: string) => void;
  onDeletePhoto?: (photoId: string) => void;
  onAddPhotos?: (activityId: string) => void;
}

/**
 * Props for TripStats component
 */
export interface TripStatsProps {
  stats: TripStats;
  tripTitle: string;
  favoriteActivity?: {
    id: string;
    name: string;
    photo_url?: string;
    rating?: number;
    notes?: string;
  };
}

// ============================================================================
// GAMIFICATION / XP SYSTEM
// ============================================================================

/**
 * XP values for different activity types
 * Higher XP for activities that represent core travel experiences
 */
export const ACTIVITY_XP: Record<string, number> = {
  // Cultural & Landmarks - Core travel experiences (+15 XP)
  cultural: 15,
  museum: 15,
  landmark: 15,
  attraction: 15,

  // Food & Entertainment - Memorable experiences (+12 XP)
  food: 12,
  restaurant: 12,
  foodie: 12,
  entertainment: 12,
  nightlife: 12,
  event: 12,

  // Nature & Wellness (+12 XP)
  nature: 12,
  park: 12,
  spa: 10,
  wellness: 10,

  // Shopping & Cafes (+8 XP)
  shopping: 8,
  market: 8,
  cafe: 8,
  bar: 8,

  // Logistics (+5 XP)
  transport: 5,
  activity: 10, // Generic fallback
};

/**
 * Streak multipliers for consecutive completions
 */
export const STREAK_MULTIPLIERS: Record<number, number> = {
  0: 1,
  1: 1,
  2: 1,
  3: 1.25,  // 25% bonus after 3-streak
  4: 1.5,   // 50% bonus after 4-streak
  5: 1.75,  // 75% bonus after 5-streak
  6: 2,     // 2x bonus after 6+ streak
};

/**
 * Achievement definitions
 */
export type AchievementId =
  | "early_bird"      // Complete first activity before 9am
  | "night_owl"       // Complete activity after 9pm
  | "foodie"          // Complete 3+ food activities
  | "culture_vulture" // Complete 5+ cultural/museum activities
  | "day_master"      // Complete all activities in a day
  | "streak_3"        // Achieve 3-activity streak
  | "streak_5"        // Achieve 5-activity streak
  | "perfectionist"   // Complete trip with 0 skips
  | "explorer"        // Visit 10+ unique locations
  | "speed_runner"    // Complete 3 activities within 3 hours
  | "first_steps"     // Complete first activity of the trip
  | "halfway_there"   // Complete 50% of trip activities
  | "finish_line";    // Complete all trip activities

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  icon: string;
  xpBonus: number;
  rarity: "common" | "rare" | "epic" | "legendary";
}

export const ACHIEVEMENTS: Record<AchievementId, Achievement> = {
  first_steps: {
    id: "first_steps",
    name: "First Steps",
    description: "Complete your first activity",
    icon: "👣",
    xpBonus: 25,
    rarity: "common",
  },
  early_bird: {
    id: "early_bird",
    name: "Early Bird",
    description: "Complete an activity before 9:00 AM",
    icon: "🌅",
    xpBonus: 30,
    rarity: "common",
  },
  night_owl: {
    id: "night_owl",
    name: "Night Owl",
    description: "Complete an activity after 9:00 PM",
    icon: "🦉",
    xpBonus: 30,
    rarity: "common",
  },
  foodie: {
    id: "foodie",
    name: "Foodie",
    description: "Complete 3 food-related activities",
    icon: "🍽️",
    xpBonus: 50,
    rarity: "rare",
  },
  culture_vulture: {
    id: "culture_vulture",
    name: "Culture Vulture",
    description: "Complete 5 cultural or museum activities",
    icon: "🏛️",
    xpBonus: 75,
    rarity: "rare",
  },
  day_master: {
    id: "day_master",
    name: "Day Master",
    description: "Complete all activities in a single day",
    icon: "⭐",
    xpBonus: 50,
    rarity: "rare",
  },
  streak_3: {
    id: "streak_3",
    name: "On a Roll",
    description: "Complete 3 activities in a row",
    icon: "🔥",
    xpBonus: 25,
    rarity: "common",
  },
  streak_5: {
    id: "streak_5",
    name: "Unstoppable",
    description: "Complete 5 activities in a row",
    icon: "⚡",
    xpBonus: 75,
    rarity: "rare",
  },
  speed_runner: {
    id: "speed_runner",
    name: "Speed Runner",
    description: "Complete 3 activities within 3 hours",
    icon: "🏃",
    xpBonus: 40,
    rarity: "rare",
  },
  explorer: {
    id: "explorer",
    name: "Explorer",
    description: "Visit 10 unique locations",
    icon: "🧭",
    xpBonus: 100,
    rarity: "epic",
  },
  halfway_there: {
    id: "halfway_there",
    name: "Halfway There",
    description: "Complete 50% of your trip activities",
    icon: "🎯",
    xpBonus: 50,
    rarity: "rare",
  },
  perfectionist: {
    id: "perfectionist",
    name: "Perfectionist",
    description: "Complete entire trip without skipping",
    icon: "💎",
    xpBonus: 200,
    rarity: "legendary",
  },
  finish_line: {
    id: "finish_line",
    name: "Finish Line",
    description: "Complete all trip activities",
    icon: "🏆",
    xpBonus: 150,
    rarity: "epic",
  },
};

/**
 * User's gamification progress for a trip
 */
export interface TripGamification {
  tripId: string;
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  unlockedAchievements: AchievementId[];
  achievementUnlockedAt: Record<AchievementId, string>; // ISO timestamps

  // Activity type counts for achievement tracking
  activityTypeCounts: Record<string, number>;
  completedActivityIds: string[];
  skippedCount: number;

  // Timestamps
  lastActivityCompletedAt?: string;
  updatedAt: string;
}

/**
 * XP gain event for animations
 */
export interface XpGainEvent {
  baseXp: number;
  streakMultiplier: number;
  totalXp: number;
  newStreak: number;
  newAchievements: AchievementId[];
}
