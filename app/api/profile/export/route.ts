import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { logWriteError } from "@/lib/supabase/log-write-error";

/**
 * GET /api/profile/export
 *
 * GDPR Articles 15 and 20 - the person's data as JSON:
 * - Their profile
 * - Their trips, assistant conversations, timelines and checklists
 * - What they did on shared trips: memberships, invites, votes, reactions,
 *   proposals and expenses
 * - Likes, saves, referral codes, bananas, trip reminders, calendar links and
 *   tester access
 * - Usage counts and AI usage history
 * - Activity records: pages viewed, trip-planner steps, request logs, partner
 *   links opened, votes cast before signing in, trips joined as a guest, saved
 *   itinerary versions and feedback sent (the newest 1,000 of each)
 *
 * Never in it: credentials (share, claim and invite tokens, calendar tokens and
 * the key that signs calendar links), and what other people entered about
 * themselves.
 *
 * Rate limited to 1 request per day per user.
 */

// Every users column but calendar_hmac, the key that signs the person's
// calendar feed links.
const EXPORTED_PROFILE_COLUMNS = `id, email, display_name, avatar_url, bio, home_country, home_city, date_of_birth,
  preferences, stats, current_location, current_city, current_country, location_last_updated,
  privacy_settings, notification_settings, languages, created_at, updated_at, last_sign_in_at,
  subscription_tier, subscription_expires_at, stripe_customer_id, stripe_subscription_id,
  onboarding_completed, trial_ends_at, is_pro, referred_by_code, referral_completed_at,
  welcome_completed, preferred_language, banana_balance, referral_tier, leaderboard_visibility,
  show_on_leaderboard, signed_up_via_trip_invite, login_count, profile_completed, profile_completed_at,
  cookie_consent, cookie_consent_updated_at, acquisition_source, lifetime_referral_conversions,
  paypal_handle, venmo_handle, wise_handle, username`;

/** One table's rows that belong to the person, and the columns exported. */
interface Section {
  table: string;
  columns: string;
  /** The column holding the person's id, or several of which any may. */
  owner: string | readonly string[];
  /** Newest first by this column. */
  newestBy?: string;
  limit?: number;
  /**
   * Read with the service role: no policy lets a person read their own rows
   * in this table. The owner filter is the only thing between them and
   * everyone else's.
   */
  admin?: true;
}

const SECTIONS = {
  trips: {
    table: "trips",
    columns: `id, title, description, start_date, end_date, status, visibility, budget, itinerary, trip_meta,
      packing_list, notes, tags, travel_style, created_at, updated_at`,
    owner: "user_id",
    newestBy: "created_at",
  },
  aiConversations: {
    table: "ai_conversations",
    columns: "id, trip_id, messages, created_at, updated_at",
    owner: "user_id",
    newestBy: "created_at",
  },
  activityTimelines: {
    table: "activity_timelines",
    columns: `id, trip_id, activity_id, day_number, status, started_at, completed_at, actual_duration_minutes,
      rating, experience_notes, quick_tags, skip_reason, created_at, updated_at`,
    owner: "user_id",
    newestBy: "created_at",
  },
  tripChecklists: {
    table: "trip_checklists",
    columns: "id, trip_id, text, category, is_checked, due_date, created_at, checked_at",
    owner: "user_id",
  },
  usage: {
    table: "user_usage",
    columns: `id, period_type, period_key, ai_generations_used, ai_regenerations_used, ai_assistant_messages_used,
      ai_tokens_used, places_autocomplete_used, places_search_used, places_details_used, created_at, updated_at`,
    owner: "user_id",
    newestBy: "created_at",
  },
  aiUsageHistory: {
    table: "ai_usage",
    columns: "id, trip_id, action, model_id, input_tokens, output_tokens, cost_cents, created_at",
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
  },
  tripMemberships: {
    table: "trip_collaborators",
    columns: "id, trip_id, role, joined_at",
    owner: "user_id",
  },
  // Not the invite's token, nor the email address of whoever it was for.
  tripInvites: {
    table: "trip_invites",
    columns: "id, trip_id, role, created_at, expires_at, max_uses, use_count, is_active, recipient_locale, message",
    owner: "created_by",
    newestBy: "created_at",
  },
  activityVotes: {
    table: "activity_votes",
    columns: "id, trip_id, activity_id, vote_type, comment, vote_weight, voted_at, updated_at",
    owner: "user_id",
  },
  activityReactions: {
    table: "activity_reactions",
    columns: "id, trip_id, activity_id, emoji, created_at",
    owner: "user_id",
  },
  activityProposals: {
    table: "activity_proposals",
    columns: `id, trip_id, type, activity_data, target_activity_id, target_day, target_time_slot, note, status,
      resolved_at, resolution_method, created_at, updated_at, expires_at`,
    owner: "proposed_by",
    newestBy: "created_at",
  },
  proposalVotes: {
    table: "proposal_votes",
    columns: "id, proposal_id, vote_type, comment, rank, voted_at, updated_at",
    owner: "user_id",
  },
  // Expenses the person logged or paid; not the names other travellers gave.
  tripExpenses: {
    table: "trip_expenses",
    columns: `id, trip_id, amount, currency, category, description, spent_on, created_by, paid_by_user_id,
      activity_id, created_at, updated_at`,
    owner: ["created_by", "paid_by_user_id"],
    newestBy: "created_at",
  },
  expenseShares: {
    table: "trip_expense_splits",
    columns: "id, expense_id, share_amount, settled, settled_at, created_at",
    owner: "user_id",
  },
  likedTrips: {
    table: "trip_likes",
    columns: "trip_id, created_at",
    owner: "user_id",
  },
  savedTrips: {
    table: "trip_saves",
    columns: "id, trip_id, created_at",
    owner: "user_id",
  },
  referralCodes: {
    table: "referral_codes",
    columns: "id, code, created_at, total_clicks, total_signups, total_conversions",
    owner: "user_id",
  },
  bananaTransactions: {
    table: "banana_transactions",
    columns: "id, amount, balance_after, transaction_type, reference_id, description, expires_at, expired, created_at",
    owner: "user_id",
    newestBy: "created_at",
  },
  bananaRedemptions: {
    table: "banana_redemptions",
    columns: "id, catalog_item_id, bananas_spent, status, fulfilled_at, expires_at, partner_reference, created_at",
    owner: "user_id",
    newestBy: "created_at",
  },
  tripReminders: {
    table: "scheduled_notifications",
    columns: "id, trip_id, slot, scheduled_for, status, sent_at, skipped_reason, created_at",
    owner: "user_id",
    newestBy: "scheduled_for",
  },
  calendarSyncs: {
    table: "trip_calendar_syncs",
    columns: "id, trip_id, provider, external_calendar_id, event_count, last_synced_at, status, created_at",
    owner: "user_id",
  },
  // Not the access or refresh tokens.
  calendarConnections: {
    table: "user_calendar_connections",
    columns: "provider, scope, expires_at, google_email, connected_at, last_synced_at",
    owner: "user_id",
  },
  testerAccess: {
    table: "user_tester_access",
    columns: `code_used, ai_generations_limit, ai_generations_used, ai_regenerations_limit, ai_regenerations_used,
      ai_assistant_limit, ai_assistant_used, redeemed_at, expires_at`,
    owner: "user_id",
  },
  pageViews: {
    table: "page_views",
    columns: `id, path, referrer, country, country_code, city, region, latitude, longitude, user_agent, session_id,
      is_bot, is_prefetch, created_at`,
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
  plannerSteps: {
    table: "wizard_step_events",
    columns: `id, session_id, step, entered_at, destination, duration_days, group_size, backpacker_mode, locale,
      front_door, step1_variant, result_variant, failure_code, failure_detail, referrer, utm_source, elapsed_ms,
      created_at`,
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
  funnelEvents: {
    table: "funnel_events",
    columns: "id, event_type, trip_id, session_id, anon_id, metadata, created_at",
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
  apiRequests: {
    table: "api_request_logs",
    columns: `id, api_name, endpoint, request_params, response_status, response_time_ms, cache_hit, error_message,
      cost_usd, timestamp`,
    owner: "user_id",
    newestBy: "timestamp",
    limit: 1000,
    admin: true,
  },
  partnerLinksOpened: {
    table: "hostelworld_clicks",
    columns: "id, trip_id, destination, start_date, end_date, source_path, device_class, created_at",
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
  // Not the share link's token.
  votesBeforeSignIn: {
    table: "anonymous_activity_votes",
    columns: "id, trip_id, activity_id, voter_display_name, vote_type, comment, created_at, updated_at",
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
  tripsJoinedAsGuest: {
    table: "trip_participants",
    columns: "id, trip_id, display_name, email, joined_at, source, left_at",
    owner: "user_id",
    newestBy: "joined_at",
    limit: 1000,
    admin: true,
  },
  itineraryVersions: {
    table: "trip_itinerary_snapshots",
    columns: "id, trip_id, label, itinerary, created_at",
    owner: "created_by",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
  feedback: {
    table: "user_feedback",
    columns: `id, source, uses_for, almost_stopped, last_booked_where, would_book_through_us, open_to_chat,
      contact_email, extra, created_at`,
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
  tripDeletionFeedback: {
    table: "trip_deletion_feedback",
    columns: "id, trip_id, destination, reason, custom_reason, trip_age_seconds, was_auto_saved, created_at",
    owner: "user_id",
    newestBy: "created_at",
    limit: 1000,
    admin: true,
  },
} satisfies Record<string, Section>;

function readSection(db: SupabaseClient, section: Section, userId: string) {
  let query = db.from(section.table).select(section.columns);
  query =
    typeof section.owner === "string"
      ? query.eq(section.owner, userId)
      : query.or(section.owner.map((column) => `${column}.eq.${userId}`).join(","));
  if (section.newestBy) query = query.order(section.newestBy, { ascending: false });
  if (section.limit) query = query.limit(section.limit);
  return query;
}

export async function GET() {
  const { user, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  const userId = user.id;
  const supabase = await createClient();

  try {
    // Check rate limit (1 export per day)
    const oneDay = 24 * 60 * 60 * 1000;

    // Tracked in preferences.lastDataExport. The stamp below writes
    // `preferences` back whole, so a failed read stops here: read as empty, it
    // would skip the limit and replace the person's preferences with the stamp.
    const { data: userData, error: preferencesError } = await supabase
      .from("users")
      .select("preferences")
      .eq("id", userId)
      .single();
    if (preferencesError) {
      console.error("[Data Export] preferences read failed:", preferencesError);
      return errors.internal("Failed to export data", "Data Export");
    }

    const lastExport = userData?.preferences?.lastDataExport;
    if (lastExport && Date.now() - new Date(lastExport).getTime() < oneDay) {
      return errors.rateLimit(
        "You can only export your data once per day. Please try again later.",
        { rateLimitType: "daily_export" }
      );
    }

    const sections = Object.entries(SECTIONS) as Array<[string, Section]>;
    const admin = createAdminClient();
    const [profileResult, sectionResults] = await Promise.all([
      supabase.from("users").select(EXPORTED_PROFILE_COLUMNS).eq("id", userId).single(),
      Promise.all(sections.map(([, section]) => readSection(section.admin ? admin : supabase, section, userId))),
    ]);

    // The file says what it holds, so a section that failed to load fails the
    // export instead of shipping empty. Nothing is stamped, so they can try again.
    const failed = [
      ...(profileResult.error ? [`profile: ${profileResult.error.message}`] : []),
      ...sections.flatMap(([name], i) => {
        const error = sectionResults[i].error;
        return error ? [`${name}: ${error.message}`] : [];
      }),
    ];
    if (failed.length > 0) {
      console.error("[Data Export] sections failed:", failed);
      return errors.internal("Failed to export data", "Data Export");
    }

    // Compile export data
    const exportData = {
      exportInfo: {
        exportedAt: new Date().toISOString(),
        userId,
        version: "1.3",
        dataRetentionNote:
          "This export contains your personal data stored by MonkeyTravel. Each activity record (pages " +
          "you viewed, your steps in the trip planner, request logs, partner links you opened, votes, " +
          "saved itinerary versions, feedback) is the newest 1,000 entries; write to " +
          "privacy@monkeytravel.app for older ones. Links that open your trips or calendar to others " +
          "are left out.",
      },
      profile: profileResult.data || null,
      ...Object.fromEntries(sections.map(([name], i) => [name, sectionResults[i].data || []])),
    };

    // Update last export timestamp
    logWriteError("profile/export: last export", await supabase
      .from("users")
      .update({
        preferences: {
          ...(userData?.preferences || {}),
          lastDataExport: new Date().toISOString(),
        },
      })
      .eq("id", userId));

    // Return as JSON download
    const filename = `monkeytravel-data-export-${new Date().toISOString().split("T")[0]}.json`;

    return new Response(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Data Export] Export failed:", error);
    return errors.internal("Failed to export data", "Data Export");
  }
}
