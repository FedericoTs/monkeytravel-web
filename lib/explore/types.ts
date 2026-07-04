/**
 * Shared types for the /explore UGC feature surface. Mirrors the API
 * contract in app/api/explore/trips/route.ts (extended response shape
 * landed in commit 8df7804).
 *
 * Kept separate from the broader types/index.ts so the explore
 * surface can evolve without forcing schema-wide refactors.
 */

export type BudgetTier = "budget" | "balanced" | "premium";
export type SortKey = "trending" | "recent" | "most-liked" | "most-forked";
export type TravelStyle = "classic" | "backpacker";

/** Trip card payload — what /api/explore/trips returns per trip. */
export interface ExploreTripCard {
  id: string;
  title: string;
  description: string | null;
  shareToken: string;
  /**
   * Stable public slug → drives the indexable `/trip/{publicSlug}` link.
   * Optional: pre-migration rows / non-public trips may lack it, in which
   * case TripCard falls back to the legacy `/shared/{shareToken}` link.
   */
  publicSlug?: string;
  destination: string;
  countryCode: string | null;
  durationDays: number;
  coverImage: string | null;
  tags: string[];
  budgetTier: BudgetTier | string;
  trendingScore: number;
  viewCount: number;
  copyCount: number;
  likeCount: number;
  saveCount: number;
  forkCount: number;
  author: {
    displayName: string;
    /**
     * Public handle → drives the byline link to `/creator/{username}`.
     * Optional: rows without a resolvable/public username render the byline
     * as plain text (today's behaviour).
     */
    username?: string;
  };
  authorNote: string | null;
  isEditorsPick: boolean;
  /** Travel-style preset from the wizard (classic | backpacker). */
  travelStyle: TravelStyle;
  sharedAt: string | null;
}

export interface ExploreFeedResponse {
  trips: ExploreTripCard[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/** Filter query parameters. All optional. */
export interface ExploreFilters {
  destination?: string;
  budget?: BudgetTier;
  tag?: string;
  durationMin?: number;
  durationMax?: number;
  sort?: SortKey;
  page?: number;
}
