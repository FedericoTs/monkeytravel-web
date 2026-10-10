-- Only a trip's owner and its members may read its share_token: whoever holds
-- it can join the trip's group, vote and add expenses split with the group.
-- anon and authenticated keep SELECT on every other column (lib/trips/columns.ts),
-- and the owner's and members' routes read the token with the service role.
-- A column added to trips later is not readable by them until it is granted.

revoke select on public.trips from public, anon, authenticated;

grant select (
  id, user_id, title, description, start_date, end_date, status, visibility,
  cover_image_url, tags, notes, created_at, updated_at, destination_ids, budget, itinerary,
  packing_list, emergency_contacts, shared_at, trip_meta, is_template, template_mood_tags,
  template_duration_days, template_budget_tier, template_destination, template_country,
  template_country_code, template_featured_order, template_copy_count, template_short_description,
  trending_score, submitted_to_trending_at, trending_approved, view_count, is_archived, archived_at,
  parent_trip_id, like_count, save_count, fork_count, author_display_name, author_note,
  reported_count, is_hidden, is_editors_pick, travel_style, reminders_muted, deleted_at,
  public_slug, claim_token, claim_expires_at, itinerary_version
) on public.trips to anon, authenticated;

notify pgrst, 'reload schema';
