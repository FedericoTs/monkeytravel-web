// User types
export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  default_budget_tier?: "budget" | "balanced" | "premium";
  default_pace?: "relaxed" | "moderate" | "active";
  interests?: string[];
}

// Trip types
export interface Trip {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
  status: "planning" | "confirmed" | "active" | "completed" | "cancelled";
  visibility: "private" | "shared" | "public";
  cover_image_url?: string;
  tags?: string[];
  destination_ids?: string[];
  budget?: TripBudget;
  itinerary?: ItineraryDay[];
  created_at: string;
  updated_at: string;
}

export interface TripBudget {
  total: number;
  spent: number;
  currency: string;
  category_budgets?: Record<string, number>;
}

// Itinerary types
export interface ItineraryDay {
  day_number: number;
  date: string;
  title?: string;
  theme?: string;
  activities: Activity[];
  daily_budget?: DailyBudget;
  notes?: string;
}

export interface Activity {
  id?: string;
  time_slot: "morning" | "afternoon" | "evening";
  start_time: string;
  duration_minutes: number;
  name: string;
  type: "attraction" | "restaurant" | "activity" | "transport";
  description: string;
  location: string;
  address?: string; // Full street address for map links
  coordinates?: {
    lat: number;
    lng: number;
  };
  estimated_cost: {
    amount: number;
    currency: string;
    tier: "free" | "budget" | "moderate" | "expensive";
  };
  tips: string[];
  booking_required: boolean;
  booking_url?: string;
  official_website?: string;
  image_url?: string;
}

export interface DailyBudget {
  total: number;
  breakdown: {
    activities: number;
    food: number;
    transport: number;
  };
}

// Generated itinerary from AI
export interface GeneratedItinerary {
  destination: {
    name: string;
    country: string;
    description: string;
    best_for: string[];
    weather_note: string;
  };
  days: ItineraryDay[];
  trip_summary: {
    total_estimated_cost: number;
    currency: string;
    highlights: string[];
    packing_suggestions: string[];
  };
  booking_links?: {
    flights: BookingLink[];
    hotels: BookingLink[];
  };
}

export interface BookingLink {
  provider: string;
  url: string;
  label: string;
}

// Trip creation params
export interface TripCreationParams {
  destination: string;
  startDate: string;
  endDate: string;
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  interests: string[];
  requirements?: string;
}
