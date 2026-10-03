/** Public trips a creator needs before the profile page is worth indexing on its own. */
export const MIN_PUBLIC_TRIPS_FOR_INDEX = 3;

/**
 * Whether a public creator profile should be indexed and listed in the
 * sitemap. A profile with one trip card and no bio is a thin page; its trips
 * stay indexable on their own URLs, and the profile stays `follow`.
 */
export function isCreatorIndexable(creator: { publicTripCount: number; bio?: string | null }): boolean {
  return Boolean(creator.bio?.trim()) || creator.publicTripCount >= MIN_PUBLIC_TRIPS_FOR_INDEX;
}
