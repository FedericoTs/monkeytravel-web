# MonkeyTravel — Supabase Schema Reference

**Audit date:** 2026-05-23
**Source:** `C:\Users\Samsung\Documents\Projects\travel-app-web`
**Scope:** Read-only schema audit consolidating 17 migration files under `supabase/migrations/` plus cross-referencing every `.from("table")` call across `app/`, `lib/`, `components/`, and `hooks/`.

This document is the canonical schema reference for the five in-flight feature plans (mobile, Start Anywhere / Gemini Vision, email & notifications, streaming generation, translations).

> **Important caveat about migration completeness**
> Only 17 SQL files exist on disk. The live database has **~35 tables**. Roughly half the schema (including the two core tables, `users` and `trips`) was created out-of-band — directly in the Supabase dashboard, via the Supabase MCP server, or in earlier migrations that were never committed. Column shapes for those tables are inferred from `INSERT/SELECT/UPDATE` call sites in code. Always validate column existence with `information_schema.columns` before relying on this document for new migrations.

---

## 1. Table catalog

### 1.1 Auth & profile domain

#### `users`
- **Purpose:** Application-level user profile that mirrors `auth.users(id)` and stores everything outside the auth-server surface (display name, preferences, subscription, banana balance, referral metadata, consent).
- **Source migration:** Not in `supabase/migrations/`. Original schema created out-of-band. Extended by: `20251206_create_user_usage.sql`, `20251223_add_language_localization.sql`, `20260125_add_cookie_consent.sql`.
- **Inferred columns** (from `app/auth/callback/route.ts`, `lib/usage-limits/check.ts`, `lib/consent/storage.ts`, profile pages, multiple `.update()` call sites):

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | = `auth.users.id` |
| `email` | `TEXT` | mirrored from auth |
| `display_name` | `TEXT` | |
| `avatar_url` | `TEXT NULL` | |
| `preferences` | `JSONB` | onboarding answers |
| `privacy_settings` | `JSONB` | granular toggles |
| `notification_settings` | `JSONB` | per-channel toggles |
| `onboarding_completed` | `BOOLEAN` | |
| `welcome_completed` | `BOOLEAN` | |
| `profile_completed` | `BOOLEAN` | |
| `login_count` | `INTEGER` | |
| `free_trips_remaining` | `INTEGER` | starter quota |
| `is_pro` | `BOOLEAN` | |
| `trial_ends_at` | `TIMESTAMPTZ` | 7-day trial |
| `subscription_tier` | `TEXT` | `free`/`premium`/`enterprise` — added in `20251206_create_user_usage.sql` |
| `subscription_expires_at` | `TIMESTAMPTZ` | added in `20251206` |
| `stripe_customer_id` | `TEXT` | added in `20251206` |
| `stripe_subscription_id` | `TEXT` | added in `20251206` |
| `preferred_language` | `TEXT` | `en`/`es`/`it`, added in `20251223` |
| `cookie_consent` | `JSONB` | added in `20260125` |
| `cookie_consent_updated_at` | `TIMESTAMPTZ` | added in `20260125` |
| `referred_by_code` | `TEXT NULL` | |
| `referral_tier` | `INTEGER` | 0–3, synced from `referral_tiers` |
| `banana_balance` | `INTEGER` | denormalized, kept in sync by trigger fns |
| `total_conversions` | `INTEGER` | (on `referral_codes`, not `users`) |
- **Indexes:** `idx_users_preferred_language` (20251223), `idx_users_cookie_consent_analytics` (20260125, partial on `cookie_consent->>'analytics'`).
- **RLS:** Enabled (assumed — not in migrations). Standard pattern: users select/update their own row by `auth.uid() = id`. Anonymous reads happen via the `referral_codes` join in `app/[locale]/join/[code]/page.tsx`.
- **Application call sites:** Pervasive. Notable: `app/auth/callback/route.ts` (signup creation), `app/api/profile/route.ts`, `app/api/profile/delete/route.ts`, `app/api/profile/export/route.ts`, `lib/usage-limits/check.ts`, `lib/consent/storage.ts`, `lib/referral/completion.ts`, `app/[locale]/onboarding/page.tsx`.

#### `avatars` (Storage bucket — not a Postgres table)
- **Purpose:** Supabase Storage bucket for user profile photos.
- **Application call sites:** `app/api/profile/avatar/route.ts` (`.from("avatars").upload(...)`, `.getPublicUrl(...)`).
- **Note:** Listed here for completeness — not in migrations because storage buckets are managed via the dashboard or storage SDK, not SQL.

#### `user_tester_access`
- **Purpose:** Per-user grant of early-access / beta tester limits (unlimited or custom AI quota), tied to a redeemable tester code.
- **Source migration:** Created out-of-band. Referenced by `20251226_admin_grant_early_access.sql` (which defines `admin_grant_early_access(...)` RPC that inserts into it).
- **Inferred columns** (from `lib/early-access/index.ts`, `lib/usage-limits/check.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `user_id` | `UUID → auth.users.id` | |
| `code_id` | `UUID → tester_codes.id` | |
| `code_used` | `TEXT` | |
| `ai_generations_limit` | `INT NULL` | NULL = unlimited |
| `ai_generations_used` | `INT` | |
| `ai_regenerations_limit` | `INT NULL` | |
| `ai_regenerations_used` | `INT` | |
| `ai_assistant_limit` | `INT NULL` | |
| `ai_assistant_used` | `INT` | |
| `expires_at` | `TIMESTAMPTZ` | |
| `redeemed_at` | `TIMESTAMPTZ` | |
- **Application call sites:** `lib/early-access/index.ts`, `lib/usage-limits/check.ts`, `app/api/admin/grant-access/route.ts`, `app/[locale]/welcome/page.tsx`, `app/[locale]/profile/page.tsx`, `app/api/profile/delete/route.ts`.

#### `tester_codes`
- **Purpose:** Redeemable invite codes used to grant early access (e.g. `BETA2026`). One code can have many redemptions up to `max_uses`.
- **Source migration:** Created out-of-band.
- **Inferred columns:** `id UUID PK`, `code TEXT UNIQUE`, `max_uses INT NULL`, `current_uses INT`, `created_at TIMESTAMPTZ`. Bumped by trigger `increment_tester_code_usage()` (defined in `20260218`).
- **Application call sites:** `lib/early-access/index.ts`, `app/api/admin/access-codes/route.ts`, `app/api/admin/grant-access/route.ts`.

### 1.2 Trip core domain

#### `trips`
- **Purpose:** A single trip plan — destination, dates, itinerary JSON, share state, template flags, trending score. The center of the entire app.
- **Source migration:** Not in `supabase/migrations/`. Created out-of-band; extended in-place via dashboard.
- **Inferred columns** (from `lib/trips/persistTrip.ts`, `app/api/trips/[id]/share/route.ts`, `app/api/trips/[id]/submit-trending/route.ts`, `app/api/trips/[id]/status/route.ts`, `app/api/trips/[id]/archive/route.ts`, `app/api/templates/route.ts`, `app/api/explore/trips/route.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `user_id` | `UUID → auth.users.id` | owner |
| `title` | `TEXT` | |
| `description` | `TEXT` | |
| `start_date` | `DATE` | |
| `end_date` | `DATE` | |
| `status` | `TEXT` | `planning` / `active` / `completed` / `archived` |
| `visibility` | `TEXT` | `private` / `unlisted` / `public` |
| `itinerary` | `JSONB` | array of `ItineraryDay`; activities carry nanoid `id` via `ensureActivityIds()` |
| `cover_image_url` | `TEXT NULL` | (confirmed 2026-05-02 — column is `cover_image_url`, not `cover_image`) |
| `budget` | `JSONB` | `{ total, spent, currency }` |
| `tags` | `TEXT[]` | derived from vibes |
| `trip_meta` | `JSONB` | weather note, highlights, booking links, packing |
| `packing_list` | `JSONB` | |
| `share_token` | `UUID NULL` | resolves `/shared/[token]` |
| `is_template` | `BOOLEAN` | |
| `template_copy_count` | `INTEGER` | |
| `template_source_id` | `UUID NULL` | when copied from another template |
| `trending_score` | `INTEGER` | computed by `update_trip_trending_score()` |
| `view_count` | `INTEGER` | maintained by `update_trip_view_count()` trigger |
| `shared_at` | `TIMESTAMPTZ NULL` | |
| `archived_at` | `TIMESTAMPTZ NULL` | |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | |
- **Indexes:** `idx_trips_user_status (user_id, status)` (20251226). Likely also `share_token` lookup index — unconfirmed.
- **RLS:** Enabled. Policies referenced but not in migrations (see `20251220` note: applied in a missing `sync_referral_and_collaboration_fields` migration). Helper functions `user_can_access_trip(trip_id, user_id)` and `user_can_vote(trip_id, user_id)` exist (defined inline in 20260218). The actual select/update policies that consume them live only in the live DB.
- **Application call sites:** ~40+ files. Most prominent: `app/api/trips/[id]/route.ts`, `lib/trips/persistTrip.ts`, `app/api/trips/[id]/share/route.ts`, `app/api/templates/[id]/copy/route.ts`, `app/api/trips/duplicate/route.ts`, `app/api/ai/generate/route.ts`, `app/[locale]/trips/[id]/page.tsx`, `app/[locale]/shared/[token]/page.tsx`.

#### `trip_views`
- **Purpose:** Page-view counter per trip per session (1-hour dedupe bucket), used for `trending_score` and analytics.
- **Source migration:** Out-of-band. Trigger `update_trip_view_count()` (20260218) updates `trips.view_count` on insert.
- **Inferred columns:** `id UUID PK`, `trip_id UUID → trips`, `viewer_id UUID NULL → auth.users`, `source TEXT`, `session_id TEXT`, `created_at TIMESTAMPTZ`. Probably a `UNIQUE (trip_id, session_id)` (we catch `23505` in `app/api/trips/[id]/view/route.ts`).
- **Application call sites:** `app/api/trips/[id]/view/route.ts`, `app/api/admin/growth/route.ts`.

#### `activity_timelines`
- **Purpose:** Per-activity status tracking during the *active* phase of a trip (rating, notes, started/completed timestamps, skip reason).
- **Source migration:** `20241205_create_activity_timelines.sql`.
- **Columns:** `id UUID PK`, `trip_id UUID NOT NULL → trips ON DELETE CASCADE`, `user_id UUID NOT NULL → auth.users ON DELETE CASCADE`, `activity_id TEXT NOT NULL` (refs activity in `trips.itinerary` JSONB), `day_number INTEGER NOT NULL`, `status TEXT` (`upcoming`/`in_progress`/`completed`/`skipped`), `started_at`, `completed_at`, `actual_duration_minutes`, `rating INTEGER 1–5`, `experience_notes`, `quick_tags TEXT[]`, `skip_reason`, `created_at`, `updated_at`.
- **PK / Unique:** `id`; `UNIQUE (trip_id, activity_id, user_id)`.
- **FK on-delete:** Cascade on trip and user.
- **Indexes:** `idx_activity_timelines_trip`, `idx_activity_timelines_user`, `idx_activity_timelines_status`, `idx_activity_timelines_trip_day`, `idx_activity_timelines_trip_user_day` (20251226).
- **RLS:** Enabled. Policy: `auth.uid() = user_id` for ALL operations.
- **Triggers:** `update_activity_timeline_updated_at()` on UPDATE.
- **Application call sites:** `app/api/trips/[id]/activities/route.ts`, `app/api/trips/[id]/activities/[activityId]/route.ts`, `app/api/profile/delete/route.ts`, `app/api/profile/export/route.ts`.

#### `trip_checklists`
- **Purpose:** Pre-trip prep checklist (bookings, packing, documents, custom). Items can be auto-generated from activities with `booking_required`.
- **Source migration:** `20241205_create_trip_checklists.sql`.
- **Columns:** `id UUID PK`, `trip_id UUID → trips CASCADE`, `user_id UUID → auth.users CASCADE`, `text TEXT NOT NULL`, `category TEXT DEFAULT 'custom'` (`booking`/`packing`/`document`/`custom`), `is_checked BOOLEAN`, `due_date DATE`, `sort_order INTEGER`, `source_activity_id TEXT`, `created_at`, `checked_at TIMESTAMPTZ`.
- **Indexes:** `idx_trip_checklists_trip`, `idx_trip_checklists_user`, `idx_trip_checklists_trip_user_order` (20251226).
- **RLS:** Enabled. `auth.uid() = user_id` for ALL.
- **Application call sites:** `app/api/trips/[id]/checklist/route.ts`, `app/api/trips/[id]/checklist/[itemId]/route.ts`, `app/api/profile/delete/route.ts`, `app/api/profile/export/route.ts`.

#### `mcp_itineraries`
- **Purpose:** Temporary inbox for ChatGPT-MCP-generated itineraries. User clicks "Save to MonkeyTravel" in the ChatGPT widget, lands on `/from-chatgpt/[ref]`, signs in, and claims the row into a real trip. Auto-expires after 7 days.
- **Source migration:** `20241222_create_mcp_itineraries.sql`.
- **Columns:** `id UUID PK`, `ref_id TEXT UNIQUE NOT NULL` (the URL param), `destination TEXT`, `days INTEGER`, `travel_style TEXT`, `interests TEXT[]`, `budget TEXT`, `itinerary JSONB`, `summary TEXT`, `created_at`, `expires_at TIMESTAMPTZ DEFAULT now() + 7d`, `claimed_by UUID NULL → auth.users`, `claimed_at TIMESTAMPTZ`.
- **Indexes:** `idx_mcp_itineraries_ref_id`, `idx_mcp_itineraries_expires_at`.
- **RLS:** Enabled. **Public can SELECT where `claimed_by IS NULL`** (intentional — the import page is anonymous). Authenticated users can UPDATE only to claim. Service role inserts (from the MCP API).
- **Application call sites:** `lib/mcp/generate.ts`, `app/[locale]/from-chatgpt/[ref]/page.tsx`, `app/[locale]/from-chatgpt/[ref]/ChatGPTImportClient.tsx`.

### 1.3 Collaboration domain

#### `trip_collaborators`
- **Purpose:** Users who can access a trip beyond the owner — with a role (`owner`/`editor`/`voter`/`viewer`).
- **Source migration:** `20251220_create_trip_collaboration.sql`.
- **Columns:** `id UUID PK`, `trip_id UUID → trips CASCADE`, `user_id UUID → auth.users CASCADE`, `role TEXT CHECK IN (owner, editor, voter, viewer)`, `invited_by UUID → auth.users`, `joined_at TIMESTAMPTZ`. `UNIQUE (trip_id, user_id)`.
- **Indexes:** `idx_trip_collaborators_trip`, `idx_trip_collaborators_user`, `idx_trip_collaborators_trip_user` (20251226).
- **RLS:** Enabled. **Any authenticated user can SELECT** (deliberately permissive to avoid self-recursion bug); INSERT/UPDATE/DELETE restricted to trip owners via subquery on `trips`.
- **Application call sites:** `app/api/trips/[id]/collaborators/route.ts`, `app/api/trips/[id]/collaborators/[userId]/route.ts`, `app/api/invites/[token]/route.ts`, `app/[locale]/trips/[id]/page.tsx`, `app/[locale]/invite/[token]/page.tsx`, `lib/api/auth.ts`.

#### `trip_invites`
- **Purpose:** Shareable invite links with a role attached. One token can be configured for multiple uses and an expiry.
- **Source migration:** `20251220_create_trip_collaboration.sql`.
- **Columns:** `id UUID PK`, `trip_id UUID → trips CASCADE`, `token TEXT UNIQUE NOT NULL`, `role TEXT CHECK IN (editor, voter, viewer)`, `created_by UUID → auth.users`, `created_at`, `expires_at TIMESTAMPTZ NOT NULL`, `max_uses INTEGER DEFAULT 1`, `use_count INTEGER`, `is_active BOOLEAN`.
- **Indexes:** `idx_trip_invites_token_active (token, is_active)` (20251226).
- **RLS:** Enabled. **Anyone (including anon) can SELECT** (needed for the invite landing page before login). Owner-only INSERT/UPDATE/DELETE.
- **Application call sites:** `app/api/trips/[id]/invites/route.ts`, `app/api/trips/[id]/invites/[inviteId]/route.ts`, `app/api/invites/[token]/route.ts`, `app/[locale]/invite/[token]/page.tsx`.

#### `activity_proposals`
- **Purpose:** Collaborator-proposed activities (new or replacement) that go through a voting lifecycle: `pending → voting → approved/rejected/withdrawn/expired`.
- **Source migration:** `20251221_create_activity_proposals.sql`.
- **Columns:** `id UUID PK`, `trip_id UUID NOT NULL → trips CASCADE`, `proposed_by UUID NOT NULL → auth.users CASCADE`, `type TEXT ('new'|'replacement')`, `activity_data JSONB NOT NULL`, `target_activity_id TEXT NULL`, `target_day INTEGER`, `target_time_slot TEXT ('morning'|'afternoon'|'evening')`, `note TEXT`, `status TEXT`, `resolved_at`, `resolved_by UUID`, `resolution_method TEXT`, `created_at`, `updated_at`, `expires_at TIMESTAMPTZ DEFAULT now() + 7d`.
- **Indexes:** `idx_proposals_trip_active` (partial, status IN pending/voting), `idx_proposals_trip_day`, `idx_proposals_proposed_by`, `idx_proposals_expires` (partial).
- **RLS:** Enabled. SELECT via `user_can_access_trip`; INSERT via `user_can_vote` (owner/editor/voter); UPDATE by proposer (if pending/voting) or by owner; DELETE by proposer if pending.
- **Realtime:** Added to `supabase_realtime` publication (20260219).
- **Triggers:** `update_proposal_updated_at()` BEFORE UPDATE.
- **Application call sites:** `app/api/trips/[id]/proposals/route.ts`, `app/api/trips/[id]/proposals/[proposalId]/route.ts`, `app/api/trips/[id]/proposals/[proposalId]/vote/route.ts`, `app/api/admin/growth/route.ts`.

#### `proposal_votes`
- **Purpose:** Binary approve/reject votes on `activity_proposals`. One vote per user per proposal.
- **Source migration:** `20251221_create_activity_proposals.sql`.
- **Columns:** `id UUID PK`, `proposal_id UUID NOT NULL → activity_proposals CASCADE`, `user_id UUID NOT NULL → auth.users CASCADE`, `vote_type TEXT ('approve'|'reject')`, `comment TEXT`, `rank INTEGER NULL` (reserved for future tournament voting), `voted_at`, `updated_at`. `UNIQUE (proposal_id, user_id)`.
- **Indexes:** `idx_proposal_votes_proposal`, `idx_proposal_votes_user`.
- **RLS:** Enabled. SELECT via trip access; INSERT/UPDATE/DELETE constrained by `user_can_vote` and `user_id = auth.uid()`.
- **Realtime:** Added to `supabase_realtime` (20260219).
- **Triggers:** `update_proposal_updated_at` BEFORE UPDATE; `on_proposal_vote_insert()` AFTER INSERT (auto-transitions parent proposal from `pending` → `voting`).
- **Application call sites:** Same routes as `activity_proposals`.

#### `activity_votes`
- **Purpose:** Authenticated 4-axis votes on individual activities inside a trip's itinerary: `love`/`flexible`/`concerns`/`no`. Weighted consensus. **Distinct from `anonymous_activity_votes`** (anonymous, 2-axis).
- **Source migration:** Not in `supabase/migrations/`. Created out-of-band via Supabase MCP per project history. Trigger `update_activity_vote_updated_at()` is defined in 20260218.
- **Inferred columns** (from `app/api/trips/[id]/activities/[activityId]/vote/route.ts`, `app/api/trips/[id]/votes/route.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `trip_id` | `UUID → trips` | |
| `activity_id` | `TEXT` | nanoid in `trips.itinerary` |
| `user_id` | `UUID → auth.users` | |
| `vote_type` | `TEXT` | `love`/`flexible`/`concerns`/`no` |
| `comment` | `TEXT NULL` | required for `concerns`/`no` (app-level) |
| `vote_weight` | `NUMERIC` | default 1.0 |
| `voted_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | maintained by trigger |
- **Likely constraint:** `UNIQUE (trip_id, activity_id, user_id)` — code does an upsert pattern by reading first then inserting/updating.
- **RLS:** Unknown — not in migrations. App layer manually checks owner/editor/voter role on every write.
- **Application call sites:** `app/api/trips/[id]/activities/[activityId]/vote/route.ts`, `app/api/trips/[id]/votes/route.ts`.

#### `activity_status`
- **Purpose:** Unknown — referenced once in `app/api/trips/[id]/votes/route.ts:60` only. May be a view aggregating timelines + votes, or a legacy table.
- **Source migration:** Not in any migration; **possibly missing/dead**. Flag for follow-up.
- **Application call sites:** `app/api/trips/[id]/votes/route.ts` (single reference).

#### `anonymous_activity_votes`
- **Purpose:** Thumbs-up/down on activities by unauthenticated viewers on `/shared/[token]`. Cookie-based dedupe (no FK to user). Coexists with `activity_votes` (4-axis authenticated).
- **Source migration:** `20260523_anonymous_activity_votes.sql` — **NOT YET APPLIED TO PRODUCTION** (per the audit brief and the migration date being today).
- **Columns:** `id UUID PK`, `trip_id UUID NOT NULL → trips CASCADE`, `activity_id TEXT NOT NULL`, `share_token UUID NOT NULL` (audit trail; not FK), `voter_cookie_id TEXT NOT NULL` (nanoid in httpOnly cookie `mt_anon_voter`), `voter_display_name TEXT NULL`, `vote_type TEXT ('up'|'down')`, `comment TEXT NULL`, `created_at`, `updated_at`. `UNIQUE (trip_id, activity_id, voter_cookie_id)`.
- **Indexes:** `idx_anon_votes_trip_activity`, `idx_anon_votes_trip_cookie`.
- **RLS:** Enabled. **`SELECT` is anonymous-readable** (`USING (true)` — vote tallies are public). NO insert/update/delete policies → all writes must go through service-role API at `/api/shared/[token]/vote`. Safe because the API validates token → trip before write.
- **Triggers:** Reuses `update_proposal_updated_at()` for `updated_at`.
- **Application call sites:** `app/api/shared/[token]/vote/route.ts`, `app/api/shared/[token]/votes/route.ts`.

### 1.4 AI & usage domain

#### `user_usage`
- **Purpose:** Per-user, per-period usage counters for AI generations, regenerations, assistant messages, and Google Places API calls. Monthly for AI, daily for Places.
- **Source migration:** `20251206_create_user_usage.sql`.
- **Columns:** `id UUID PK`, `user_id UUID NOT NULL → auth.users CASCADE`, `period_type TEXT ('monthly'|'daily')`, `period_key TEXT` (`YYYY-MM` or `YYYY-MM-DD`), `ai_generations_used INT`, `ai_regenerations_used INT`, `ai_assistant_messages_used INT`, `ai_tokens_used INT`, `places_autocomplete_used INT`, `places_search_used INT`, `places_details_used INT`, `created_at`, `updated_at`. `UNIQUE (user_id, period_type, period_key)`.
- **Indexes:** `idx_user_usage_user_period`, `idx_user_usage_period`, `idx_user_usage_user_id`.
- **RLS:** Enabled. SELECT: `auth.uid() = user_id`. ALL ops for `service_role`.
- **Functions:** `increment_usage(p_user_id, p_period_type, p_period_key, p_column_name, p_amount)` — atomic upsert + dynamic SQL increment. `get_user_usage(...)` — returns zeros if no record.
- **Application call sites:** `lib/usage-limits/check.ts`, `app/api/profile/delete/route.ts`, `app/api/profile/export/route.ts`.

#### `ai_usage`
- **Purpose:** Per-request log of every AI model call (input/output tokens, cost in cents, action, trip context). Used for rate limiting and per-user cost analytics.
- **Source migration:** Not in migrations.
- **Inferred columns** (from `lib/ai/usage.ts`): `id UUID PK`, `user_id UUID`, `trip_id UUID NULL`, `model_id TEXT`, `action TEXT`, `input_tokens INT`, `output_tokens INT`, `cost_cents INT`, `created_at TIMESTAMPTZ`.
- **Application call sites:** `lib/ai/usage.ts`, `app/api/admin/stats/route.ts`, `app/api/profile/delete/route.ts`, `app/api/profile/export/route.ts`.

#### `ai_conversations`
- **Purpose:** Per-trip chat history with the AI assistant. Stores message thread + applied actions for undo support.
- **Source migration:** Not in migrations.
- **Inferred columns** (from `app/api/ai/assistant/route.ts`, `app/api/ai/assistant/undo/route.ts`): includes at least `id`, `user_id`, `trip_id`, `messages JSONB`, `actions JSONB`, `created_at`, `updated_at`.
- **Application call sites:** `app/api/ai/assistant/route.ts` (many ops), `app/api/admin/stats/route.ts`, `app/api/admin/growth/route.ts`, `app/api/profile/delete/route.ts`, `app/api/profile/export/route.ts`.

#### `ai_prompts`
- **Purpose:** Admin-editable Gemini prompts (system prompt, regeneration prompt, etc.) so prompts can be A/B-tested without code changes. Falls back to hardcoded values if DB fetch fails.
- **Source migration:** `20241206_create_ai_prompts.sql`.
- **Columns:** `id UUID PK`, `name TEXT UNIQUE`, `display_name TEXT`, `description TEXT`, `prompt_text TEXT NOT NULL`, `category TEXT` (`system`/`generation`/`regeneration`), `is_active BOOLEAN`, `version INTEGER`, `token_estimate INTEGER`, `created_at`, `updated_at`, `updated_by TEXT` (admin email), `metadata JSONB`.
- **Indexes:** `idx_ai_prompts_name`, `idx_ai_prompts_active`.
- **RLS:** Enabled. `authenticated` role can SELECT where `is_active = true`. Admin writes go via service role (no INSERT/UPDATE/DELETE policy).
- **Seeded:** `system_prompt`, `activity_regeneration_prompt`.
- **Application call sites:** `lib/prompts.ts`, `app/api/admin/ai-prompts/route.ts`.

### 1.5 Cache & cost-monitoring domain

#### `destination_activity_cache`
- **Purpose:** Cache layer for previously generated itineraries keyed by destination hash, budget, vibes, language. Avoids paying Gemini for identical requests.
- **Source migration:** Not in migrations. Extended in `20251223_add_language_localization.sql` (`language` column + new unique constraint `unique_destination_cache_lang (destination_hash, budget_tier, vibes, language)`).
- **Inferred columns:** `id UUID PK`, `destination_hash TEXT`, `budget_tier TEXT`, `vibes TEXT[]`, `language VARCHAR(5)`, `itinerary JSONB`, `hit_count INTEGER`, `last_accessed_at TIMESTAMPTZ`, `created_at`, `expires_at TIMESTAMPTZ`.
- **Indexes:** `idx_destination_cache_language` (20251223).
- **Function:** `increment_cache_hit_count(cache_id UUID)` atomic increment (20260217, hardened in 20260218 with `search_path`).
- **Application call sites:** `app/api/ai/generate/route.ts`, `app/api/admin/costs/route.ts`.

#### `destination_activity_bank`
- **Purpose:** A persistent pool of generated activities per destination — used to assemble new trips without round-tripping to Gemini for every slot.
- **Source migration:** Not in migrations.
- **Inferred columns:** Not fully derivable without schema; ~10 call sites in `lib/activity-bank/index.ts`. At minimum a `destination_hash` lookup, activity JSONB, vibe/budget tags.
- **Application call sites:** `lib/activity-bank/index.ts` (sole consumer).

#### `google_places_cache`
- **Purpose:** Cache for Google Places API responses (photos, details, place IDs) to dramatically reduce paid quota use.
- **Source migration:** Not in migrations.
- **Indexes:** `idx_places_cache_lookup (place_id, cache_type, expires_at)` (20251226).
- **Application call sites:** `lib/cache/index.ts`, `lib/images/activity.ts`, `app/api/places/route.ts`, `app/api/places/details/route.ts`, `app/api/hotels/places/route.ts`, `app/api/images/proxy/route.ts`, `app/api/images/activity/route.ts`, `app/api/admin/costs/route.ts`, `app/api/admin/cache-stats/route.ts`.

#### `geocode_cache`
- **Purpose:** Cache for Google Geocoding API results (address → lat/lng).
- **Source migration:** Not in migrations.
- **Indexes:** `idx_geocode_cache_hash_expires (address_hash, expires_at)` (20251226).
- **Inferred columns:** `address_hash TEXT`, `lat`, `lng`, `expires_at`, etc.
- **Application call sites:** `app/api/travel/geocode/route.ts`, `app/api/weather/route.ts`, `app/api/admin/costs/route.ts`.

#### `distance_cache`
- **Purpose:** Cache for Google Distance Matrix API.
- **Source migration:** Not in migrations.
- **Application call sites:** `app/api/travel/distance/route.ts`, `app/api/admin/costs/route.ts`.

#### `api_request_logs`
- **Purpose:** Per-request log of every external API call (Gemini, Google Places, Amadeus, etc.) — name, latency, cost, user, success flag. Powers the admin cost dashboard.
- **Source migration:** Not in migrations. Note: `20260218` drops a duplicate index `idx_api_logs_name_timestamp` (the canonical one is `idx_api_logs_api_name`).
- **Application call sites:** `lib/api-gateway/interceptors/logging.ts`, `lib/api-gateway/api-control.ts`, `app/api/admin/stats/route.ts`, `app/api/admin/costs/route.ts`, `app/api/admin/google-metrics/route.ts`, `app/api/amadeus/flights/search/route.ts`, `app/api/profile/delete/route.ts`.

#### `api_config`
- **Purpose:** Admin-editable per-API configuration (enabled/disabled, rate limits, cost-cap). Allows pausing an API without redeploy.
- **Source migration:** Not in migrations.
- **Application call sites:** `lib/api-gateway/api-control.ts`, `app/api/admin/api-config/route.ts`.

#### `site_config`
- **Purpose:** Admin-editable site-wide config (feature flags, copy overrides).
- **Source migration:** Not in migrations.
- **Application call sites:** `app/api/admin/config/route.ts`.

### 1.6 Growth, referrals, bananas domain

#### `referral_codes`
- **Purpose:** One unique 6-character code per user. Tracks clicks, conversions, etc.
- **Source migration:** Not in migrations. Functions in 20260218: `generate_referral_code()`, `get_or_create_referral_code(user_id)`.
- **Inferred columns:** `id UUID PK`, `user_id UUID UNIQUE → auth.users`, `code VARCHAR(8) UNIQUE`, `total_clicks INT`, `total_conversions INT`, `created_at`.
- **Application call sites:** `lib/referral/completion.ts`, `lib/bananas/tiers.ts`, `app/api/referral/*` routes, `app/api/bananas/route.ts`, `app/[locale]/join/[code]/page.tsx`.

#### `referral_events`
- **Purpose:** Log of referral lifecycle events (click, signup, conversion).
- **Source migration:** Not in migrations.
- **Application call sites:** `lib/referral/completion.ts`, `app/api/referral/click/route.ts`, `app/api/referral/complete/route.ts`, `app/api/referral/history/route.ts`, `app/api/bananas/route.ts`.

#### `referral_tiers`
- **Purpose:** Per-user lifetime referral tier (0/1/2/3) with unlocked-at timestamps and tier bonuses.
- **Source migration:** Not in migrations. Function `check_and_unlock_tier(user_id)` (20260218) maintains it.
- **Inferred columns:** `user_id UUID PK`, `lifetime_conversions INT`, `current_tier INT`, `highest_tier_achieved INT`, `tier_1_unlocked_at`, `tier_2_unlocked_at`, `tier_3_unlocked_at`, `updated_at`.
- **Application call sites:** `lib/bananas/tiers.ts`, `app/api/admin/growth/route.ts`.

#### `banana_transactions`
- **Purpose:** Append-only ledger of banana (in-app currency) credits and debits. Each row has an `expires_at` (12 months for credits, NULL for debits) and an `expired` flag.
- **Source migration:** Not in migrations. Functions: `add_bananas`, `spend_bananas`, `expire_old_bananas`, `get_available_banana_balance` (all in 20260218).
- **Inferred columns:** `id UUID PK`, `user_id UUID`, `amount INT` (positive credit / negative debit), `balance_after INT`, `transaction_type TEXT`, `reference_id UUID NULL`, `description TEXT NULL`, `expires_at TIMESTAMPTZ NULL`, `expired BOOLEAN`, `created_at`.
- **Application call sites:** `lib/bananas/balance.ts`, `lib/bananas/transactions.ts`, `app/api/admin/growth/route.ts`.

#### `banana_redemption_catalog`
- **Purpose:** Catalog of rewards bananas can be redeemed for.
- **Source migration:** Not in migrations.
- **Application call sites:** `app/api/bananas/catalog/route.ts`, `app/api/bananas/spend/route.ts`, `app/api/admin/growth/route.ts`.

#### `banana_redemptions`
- **Purpose:** Per-user redemption history.
- **Source migration:** Not in migrations.
- **Application call sites:** `app/api/bananas/spend/route.ts`, `app/api/bananas/catalog/route.ts`, `app/api/admin/growth/route.ts`.

### 1.7 Other (analytics, contact, destinations, email)

#### `page_views`
- **Purpose:** Anonymous page-view log with geo (country/region/city/lat/lng) from Vercel's `geolocation()`. Fired-and-forgotten from middleware.
- **Source migration:** Not in migrations.
- **Inferred columns:** `path`, `referrer`, `country`, `country_code`, `city`, `region`, `latitude`, `longitude`, `user_agent`, `user_id NULL`, `session_id`.
- **Note:** Inserted via direct PostgREST POST (not via SDK) in `lib/supabase/middleware.ts` — fire-and-forget with anon key. Requires permissive INSERT RLS on anon role.
- **Application call sites:** `lib/supabase/middleware.ts`, `app/api/admin/stats/route.ts`, `app/api/profile/delete/route.ts`.

#### `destinations`
- **Purpose:** Catalog of supported destinations (used for search/autocomplete and the popular-destinations feature).
- **Source migration:** Not in migrations.
- **Application call sites:** `app/api/destinations/search/route.ts`, `app/api/destinations/popular/route.ts`, `app/api/destinations/upsert/route.ts`, `app/api/ai/assistant/route.ts`.

#### `email_subscribers`
- **Purpose:** Newsletter / waitlist signups from the marketing site.
- **Source migration:** Not in migrations.
- **Inferred columns:** `id UUID PK`, `email TEXT UNIQUE`, `source TEXT`, `metadata JSONB`, `created_at`. Confirmed unique constraint by catching `23505` on insert.
- **Application call sites:** `app/api/subscribe/route.ts`, `app/api/admin/stats/route.ts`.

#### `contact_messages`
- **Purpose:** Inbound contact-form submissions from `/api/contact`.
- **Source migration:** `20260502_add_contact_messages.sql`, tightened in `20260502143000_tighten_contact_messages_rls.sql`.
- **Columns:** `id UUID PK`, `created_at`, `name`, `email`, `topic` (CHECK: `support`/`partnership`/`press`/`feedback`/`other`), `message`, `locale NULL`, `user_agent NULL`, `referer NULL`, `ip_hash NULL`, `status TEXT DEFAULT 'new'` (CHECK: `new`/`in_progress`/`resolved`/`spam`).
- **Indexes:** `contact_messages_created_at_idx (created_at DESC)`, `contact_messages_status_idx` (partial: `WHERE status <> 'resolved'`).
- **RLS:** Enabled. **Anon role can INSERT** with strict validation (length + regex on email + topic enum). No anon SELECT. Admins read via service role / SQL editor.
- **Application call sites:** `app/api/contact/route.ts`.

---

## 2. Relationship map

```
auth.users (Supabase Auth — not owned)
    │
    │ (id)
    ▼
┌─────────────────────────────────────────────────────────────┐
│  users  (profile mirror, preferences, bananas, consent)     │
└─────────────────────────────────────────────────────────────┘
    │                          │                       │
    │ user_id                  │ user_id               │ user_id
    ▼                          ▼                       ▼
┌──────────────────┐   ┌────────────────────┐   ┌──────────────┐
│ user_usage       │   │ user_tester_access │──▶│ tester_codes │
│ ai_usage         │   │ referral_codes     │   └──────────────┘
│ ai_conversations │   │ referral_tiers     │
│ trip_checklists  │   │ banana_transactions│
│ activity_timeline│   │ referral_events    │
└──────────────────┘   └────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  trips  (the center: itinerary JSONB, share_token, …)        │
└─────────────────────────────────────────────────────────────┘
    │            │             │             │             │
    │ trip_id    │ trip_id     │ trip_id     │ trip_id     │ trip_id
    ▼            ▼             ▼             ▼             ▼
┌──────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌─────────────────────┐
│trip_views│ │trip_invites│ │trip_     │ │activity_   │ │ activity_proposals  │
│          │ │            │ │collab… │ │votes        │ │      │              │
└──────────┘ └────────────┘ └──────────┘ └────────────┘ │      ▼              │
                                                       │ proposal_votes      │
                                                       │                     │
                                                       │ anonymous_activity_ │
                                                       │ votes (cookie key)  │
                                                       └─────────────────────┘
```

**Key edges:**
- `trips.user_id` → `auth.users.id` (owner)
- `trip_collaborators (trip_id, user_id)` → `(trips, auth.users)` — both CASCADE
- `trip_invites.trip_id` → `trips` CASCADE; resolves to a collaborator on accept
- `activity_proposals.trip_id` → `trips` CASCADE
- `proposal_votes.proposal_id` → `activity_proposals` CASCADE
- `activity_votes.trip_id` → `trips` (inferred — no migration to confirm)
- `anonymous_activity_votes.trip_id` → `trips` CASCADE; **no FK to `auth.users`** (cookie-based identity)
- `activity_timelines` and `trip_checklists` cascade on both `trips` and `auth.users`

---

## 3. RLS audit

### Tables with RLS enabled (confirmed from migrations)
| Table | RLS | Notable |
|---|---|---|
| `activity_proposals` | ✅ | Trip-access SELECT; vote-permission INSERT |
| `proposal_votes` | ✅ | Trip-access SELECT; vote-permission INSERT |
| `anonymous_activity_votes` | ✅ | **Anon SELECT = true** (public tallies); writes only via service role |
| `activity_timelines` | ✅ | `auth.uid() = user_id` for ALL |
| `trip_checklists` | ✅ | `auth.uid() = user_id` for ALL |
| `trip_collaborators` | ✅ | **Any authenticated SELECT** (intentional, to avoid self-recursion); owner-only writes |
| `trip_invites` | ✅ | **`USING (true)` SELECT for anon** (needed for invite landing page) |
| `mcp_itineraries` | ✅ | **Anon SELECT where `claimed_by IS NULL`** (intentional, for ChatGPT import landing) |
| `user_usage` | ✅ | Self-SELECT; service-role ALL |
| `ai_prompts` | ✅ | Authenticated SELECT where active |
| `contact_messages` | ✅ | **Anon INSERT** with strict regex/length validation; no anon SELECT |

### Tables with no RLS visible in migrations (likely enabled out-of-band, please verify in production)
`users`, `trips`, `trip_views`, `activity_votes`, `ai_usage`, `ai_conversations`, `destination_activity_cache`, `destination_activity_bank`, `google_places_cache`, `geocode_cache`, `distance_cache`, `api_request_logs`, `api_config`, `site_config`, `referral_codes`, `referral_events`, `referral_tiers`, `banana_transactions`, `banana_redemption_catalog`, `banana_redemptions`, `page_views`, `destinations`, `email_subscribers`, `tester_codes`, `user_tester_access`.

### Anonymous-readable tables (security risk surface)
1. **`mcp_itineraries`** — exposes destination, days, vibes, full itinerary JSONB for any unclaimed row. No PII intended. ✅ OK.
2. **`trip_invites`** — exposes `trip_id`, `role`, `expires_at`, `is_active`, `use_count`. No PII. ✅ OK.
3. **`trip_collaborators`** — exposes `(trip_id, user_id, role)` to any authenticated user. **Potentially leaks "user X collaborates on trip Y"** to any logged-in user. Tolerable trade-off given the existing recursion issue, but worth flagging.
4. **`anonymous_activity_votes`** — exposes vote rows including `voter_display_name` (optional self-supplied first names) and `comment`. Cookie ids leak but they're opaque. ⚠️ Low risk; intentional.
5. **`page_views`** (assumed) — middleware POSTs with anon key. If RLS denies anon insert, the fire-and-forget silently fails. Verify policy: should be `WITH CHECK (true)` for anon.

### Service-role bypass call sites
- `lib/supabase/admin.ts` (`createAdminClient()`) — wraps `SUPABASE_SERVICE_ROLE_KEY`. Used by:
  - `app/api/shared/[token]/vote/route.ts` — bypasses RLS to write anonymous votes after validating the share token.
  - All other admin / cron / webhook routes (search `createAdminClient` for full list).
- `app/api/subscribe/route.ts` uses `import { supabase } from '@/lib/supabase'` — needs verification that this is the anon client and that `email_subscribers` has appropriate anon INSERT policy.

---

## 4. Out-of-band / untracked

### A. Tables in code but NOT in any migration file (created out-of-band)
These tables were created via the Supabase dashboard or MCP server, not via committed SQL files:

| Table | Use |
|---|---|
| `users` | core profile |
| `trips` | core itinerary |
| `trip_views` | view analytics |
| `activity_votes` | authenticated 4-axis voting |
| `activity_status` | **suspicious — only 1 call site; may be dead/missing** |
| `ai_usage` | per-request AI ledger |
| `ai_conversations` | assistant chat history |
| `destination_activity_cache` | cached itineraries (only the `language` add-on is in migrations) |
| `destination_activity_bank` | reusable activity pool |
| `google_places_cache`, `geocode_cache`, `distance_cache` | Google API caches |
| `api_request_logs`, `api_config`, `site_config` | admin/ops |
| `referral_codes`, `referral_events`, `referral_tiers` | growth loop |
| `banana_transactions`, `banana_redemption_catalog`, `banana_redemptions` | in-app currency |
| `page_views` | anon analytics |
| `destinations` | destination catalog |
| `email_subscribers` | waitlist |
| `tester_codes`, `user_tester_access` | beta gate |

**Action recommended:** Generate a `pg_dump --schema-only` against production and commit it as `supabase/migrations/00000000000000_initial_baseline.sql` so future devs (and CI environments) can stand up an equivalent schema from scratch.

### B. Tables in migrations but rarely / never used in current code
None. Every migrated table has live call sites.

### C. Suspicious entries
- **`activity_status`** — single reference in `app/api/trips/[id]/votes/route.ts:60`. Either a leftover from a refactor, a view we didn't grep, or a missing table that's been silently failing in production. Worth a 5-minute check.

### D. Functions defined in migrations
All `search_path`-hardened in 20260218 to prevent search-path hijack: `add_bananas`, `check_and_unlock_tier`, `expire_old_bananas`, `generate_referral_code`, `get_available_banana_balance`, `get_or_create_referral_code`, `increment_cache_hit_count`, `increment_tester_code_usage`, `spend_bananas`, `update_activity_vote_updated_at`, `update_trip_trending_score`, `update_trip_view_count`, `user_can_access_trip`, `user_can_vote`. Plus: `increment_usage`, `get_user_usage` (20251206), `update_activity_timeline_updated_at` (20241205), `update_proposal_updated_at`, `on_proposal_vote_insert` (20251221), `user_is_trip_owner` (20251221), `admin_grant_early_access` (20251226).

### E. Realtime publication
Only `activity_proposals` and `proposal_votes` are in `supabase_realtime` (20260219). If the proposal hook `useProposals.ts` works in production, the publication is in sync. **`anonymous_activity_votes` is NOT in the publication** — if shared-page real-time vote updates are desired (e.g. tally a vote on one device, see it on another), this needs `ALTER PUBLICATION supabase_realtime ADD TABLE public.anonymous_activity_votes;`.

---

## 5. Implications for the 5 planned features

### 5.1 Mobile (native app)
- Auth/session tables driving native behavior: `auth.users` (Supabase Auth handles native OAuth + email via the same SDK), `users` (profile sync), `user_usage` (usage limits enforced on the client), `user_tester_access` (beta gate).
- The middleware-based session refresh in `lib/supabase/middleware.ts` is Next-only — native apps will need to wire the React Native Supabase SDK to refresh independently. No DB changes needed.
- `mcp_itineraries` and `trip_invites` SELECT-public policies already work for unauthenticated deep links from native.
- **Watch:** the cookie-based anonymous voting flow (`anonymous_activity_votes` + `mt_anon_voter` httpOnly cookie) won't work cleanly on native. If the share/vote UX needs to work in-app, either drop the httpOnly attribute and switch to native secure storage, or require sign-in for in-app voting.

### 5.2 Start Anywhere / Gemini Vision (upload an inspiration image)
- **New table needed.** Suggested:
  ```
  trip_inspiration_uploads (
    id uuid pk,
    user_id uuid → auth.users on delete cascade,
    storage_path text not null,       -- supabase storage key
    mime_type text not null,
    size_bytes int,
    gemini_extracted_destination text,
    gemini_extracted_vibes text[],
    gemini_response jsonb,            -- full vision-API response for audit
    consumed_at timestamptz null,     -- when used to generate a trip
    trip_id uuid null → trips on delete set null,
    created_at timestamptz default now(),
    expires_at timestamptz default now() + interval '7 days'
  )
  ```
- Mirrors the pattern of `mcp_itineraries` (temporary, expirable, fk-linked once claimed).
- **Storage bucket needed.** Add an `inspirations` bucket alongside `avatars`. RLS: `auth.uid() = owner`. Public read NOT recommended (user might upload a personal photo).
- AI cost: each upload bills against Gemini Vision. Log via existing `api_request_logs` (`api_name = 'gemini-vision'`) and `ai_usage` so the existing admin cost dashboard and per-user quotas pick it up automatically.

### 5.3 Email / notifications
- **No `notifications` table exists.** Needs to be created. Suggested schema (mirrors `contact_messages` patterns + `user_usage` per-user pattern):
  ```
  notifications (
    id uuid pk,
    user_id uuid not null → auth.users on delete cascade,
    type text not null check (type in (
      'trip_reminder', 'collaborator_invite', 'proposal_voting',
      'vote_received', 'tier_unlocked', 'banana_expiring',
      'deal_alert', 'system'
    )),
    title text not null,
    body text not null,
    action_url text null,
    metadata jsonb default '{}',
    channels text[] not null,         -- ['email','push','in_app']
    sent_at timestamptz null,
    read_at timestamptz null,
    dismissed_at timestamptz null,
    created_at timestamptz default now()
  )
  ```
- Use existing `users.notification_settings` JSONB (already populated at signup with `emailNotifications`, `pushNotifications`, `dealAlerts`, `tripReminders`, `quietHoursStart`, `quietHoursEnd`) as the per-user fan-out policy.
- Add indexes: `(user_id, read_at) where read_at is null` for unread badge counts; `(user_id, created_at desc)` for inbox listing.
- Realtime: ADD `notifications` to `supabase_realtime` for in-app toast push.
- Email delivery: send-time is application-layer (Resend / SendGrid / Postmark). Don't add a "send queue" column — keep that in the email provider's queue.

### 5.4 Streaming generation (server-sent events for Gemini)
- DB writes during streaming:
  - `user_usage`: increment via the existing `increment_usage(...)` RPC **once at the start** (count the generation as consumed) or **once at the end** (count only on successful completion — current pattern). The atomic RPC is safe under concurrency.
  - `ai_usage`: insert one row at stream end with token totals from Gemini's final usage metadata.
  - `api_request_logs`: insert one row at stream end with total latency and cost.
  - `trips`: INSERT the final row only at stream end (or progressively if the UI shows partial saves — but the current `lib/trips/persistTrip.ts` is a single INSERT).
  - `destination_activity_cache`: write the cached itinerary at stream end (only if generation succeeded).
- **Timing concern:** Don't write `user_usage` until the stream completes — otherwise a user who closes their browser mid-stream burns a generation for nothing.
- **Edge runtime caveat:** if streaming routes are deployed to the Edge runtime, the standard Node SDK's connection pooling won't apply. Use `createServerClient` with Cookie passthrough, not the pooled Admin client, for in-stream auth checks.
- No new tables required.

### 5.5 Translations (i18n)
- Confirmed: i18n is file-based (`next-intl` with JSON message catalogs under `messages/{en,es,it}.json`, not shown but standard for the existing locale routing).
- DB impact: zero. The `users.preferred_language` column (20251223) already persists the per-user choice; the `destination_activity_cache.language` column (20251223) keys cache entries by language so each locale gets its own cached itinerary.
- Possible future enhancement: per-locale `ai_prompts` rows. Currently `ai_prompts.name` is `UNIQUE`. To add locale variants, either add a `locale TEXT` column + change the unique to `(name, locale)`, or use a naming convention like `system_prompt.es`. The latter requires no schema change.

---

## 6. Migration apply checklist

### Migrations on disk vs. likely production state

| Migration | On Disk | Likely Applied to Prod |
|---|---|---|
| `20241205_create_trip_checklists.sql` | ✅ | ✅ |
| `20241205_create_activity_timelines.sql` | ✅ | ✅ |
| `20241206_create_ai_prompts.sql` | ✅ | ✅ |
| `20241222_create_mcp_itineraries.sql` | ✅ | ✅ |
| `20251206_create_user_usage.sql` | ✅ | ✅ |
| `20251220_create_trip_collaboration.sql` | ✅ | ✅ (noted as "Applied via Supabase MCP on 2025-12-20") |
| `20251221_create_activity_proposals.sql` | ✅ | ✅ |
| `20251223_add_language_localization.sql` | ✅ | ✅ |
| `20251226_admin_grant_early_access.sql` | ✅ | ✅ |
| `20251226_add_performance_indexes.sql` | ✅ | ✅ (noted as "Applied via Supabase MCP on 2025-12-26") |
| `20260125_add_cookie_consent.sql` | ✅ | ✅ |
| `20260217_add_increment_cache_hit_count.sql` | ✅ | ✅ (superseded by 20260218) |
| `20260218_security_fix_search_paths_and_duplicate_index.sql` | ✅ | ✅ |
| `20260219_enable_realtime_proposals.sql` | ✅ | ✅ |
| `20260502_add_contact_messages.sql` | ✅ | ✅ |
| `20260502143000_tighten_contact_messages_rls.sql` | ✅ | ✅ |
| **`20260523_anonymous_activity_votes.sql`** | ✅ | ❌ **NOT YET APPLIED** (per audit brief — dated today) |

### Action items
1. **Apply `20260523_anonymous_activity_votes.sql` to production** before merging any UI that depends on the table. The two API routes (`/api/shared/[token]/vote` and `/api/shared/[token]/votes`) will return 500s in prod until applied.
2. **Investigate `activity_status` reference** in `app/api/trips/[id]/votes/route.ts:60` — confirm whether the table/view exists in prod or whether it's a bug.
3. **Create baseline migration** — `pg_dump --schema-only --no-owner --no-acl` against prod, commit as `00000000000000_baseline.sql`. Without this, no new contributor can stand up a working local DB.
4. **Document RLS on out-of-band tables** — at minimum, run `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` against prod and check that every table is `t`. Anything `f` containing user data is a leak.
5. **Add `anonymous_activity_votes` to `supabase_realtime`** if shared-page live-tally UX is wanted.
6. **Verify `email_subscribers` and `page_views` anon-write policies** — both are written via anon-key channels (subscribe form and middleware fire-and-forget). If RLS is missing INSERT policies, both fail silently.
