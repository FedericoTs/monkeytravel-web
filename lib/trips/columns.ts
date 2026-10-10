/**
 * Every trips column the anon and authenticated roles may select: all but
 * share_token, which lets whoever holds it join the trip's group. A user-scoped
 * select("*") on trips fails with 42501, so code that wants the whole row
 * selects this. lib/security/trips-share-token.vitest.ts keeps it equal to the grant.
 */
export const TRIP_COLUMNS = `id, user_id, title, description, start_date, end_date, status, visibility,
  cover_image_url, tags, notes, created_at, updated_at, destination_ids, budget, itinerary,
  packing_list, emergency_contacts, shared_at, trip_meta, is_template, template_mood_tags,
  template_duration_days, template_budget_tier, template_destination, template_country,
  template_country_code, template_featured_order, template_copy_count, template_short_description,
  trending_score, submitted_to_trending_at, trending_approved, view_count, is_archived, archived_at,
  parent_trip_id, like_count, save_count, fork_count, author_display_name, author_note,
  reported_count, is_hidden, is_editors_pick, travel_style, reminders_muted, deleted_at,
  public_slug, claim_token, claim_expires_at, itinerary_version`;
