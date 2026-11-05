/**
 * Fields an invited editor may change. The rest of the PATCH surface
 * (status, dates, the reminders mute) stays with the owner: dates and the
 * mute re-plan the OWNER's reminder emails, and status is the trip's
 * lifecycle. Mirrors what the trips_update RLS policy already lets an editor
 * do at the row level, narrowed to the product's intent. The database's guard
 * on trips allows the same list.
 */
export const EDITOR_FIELDS = new Set([
  "itinerary",
  "title",
  "description",
  "tags",
  "budget",
  "cover_image_url",
]);
export const OWNER_ONLY_FIELDS = ["status", "start_date", "end_date", "reminders_muted"] as const;
