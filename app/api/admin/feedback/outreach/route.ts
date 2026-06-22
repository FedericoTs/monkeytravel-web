/**
 * POST /api/admin/feedback/outreach
 *
 * Admin-only. Sends the localized "we'd love your feedback" outreach email to
 * engaged users (anyone who owns at least one trip).
 *
 * SAFETY:
 *   - This endpoint is admin-gated and DRY-RUN BY DEFAULT. A dry run returns
 *     the cohort size + a small sample and sends nothing.
 *   - Actual sends require an explicit { dryRun: false } call.
 *   - Every send goes through dispatchEmail, which independently re-checks
 *     marketing opt-out (notification_settings.marketingNotifications /
 *     emailNotifications), suppression (prior bounce/complaint), and
 *     idempotency (one logical send per user via idempotencyKey). The
 *     pre-filter here only keeps the dry-run count honest — dispatchEmail is
 *     the authoritative guard.
 */

import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchEmail, type SendOutcome } from "@/lib/email/send";
import { normalizeEmailLocale } from "@/lib/email/copy";
import { buildFeedbackUrl } from "@/lib/feedback/token";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MIN_LIMIT = 1;

/** First whitespace-delimited token of a display name, or undefined. */
function firstNameOf(displayName: unknown): string | undefined {
  if (typeof displayName !== "string") return undefined;
  const first = displayName.trim().split(/\s+/)[0];
  return first || undefined;
}

interface EngagedUser {
  id: string;
  email: string;
  display_name: string | null;
  preferred_language: string | null;
  notification_settings: Record<string, unknown> | null;
}

export async function POST(request: Request) {
  const { errorResponse } = await getAuthenticatedAdmin();
  if (errorResponse) return errorResponse;

  // Parse body — tolerate an empty/invalid body (dry run is the safe default).
  let dryRun = true;
  let rawLimit: unknown = DEFAULT_LIMIT;
  try {
    const body = (await request.json()) as {
      dryRun?: boolean;
      limit?: number;
    } | null;
    if (body && typeof body.dryRun === "boolean") dryRun = body.dryRun;
    if (body && body.limit !== undefined) rawLimit = body.limit;
  } catch {
    // No/invalid JSON body — keep defaults (dryRun: true, limit: 50).
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(MIN_LIMIT, Number.isFinite(Number(rawLimit)) ? Math.floor(Number(rawLimit)) : DEFAULT_LIMIT)
  );

  const admin = createAdminClient();

  // 1. Engaged cohort = users who own ≥1 trip. Pull distinct owner ids from
  //    trips (owner column is `trips.user_id`).
  const { data: tripRows, error: tripsErr } = await admin
    .from("trips")
    .select("user_id");
  if (tripsErr) {
    console.error("[Feedback Outreach] trips query failed:", tripsErr.message);
    return errors.internal("Failed to load engaged cohort", "Feedback Outreach");
  }

  const ownerIds = [
    ...new Set(
      (tripRows ?? [])
        .map((r) => (r as { user_id: string | null }).user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];

  if (ownerIds.length === 0) {
    return apiSuccess({
      dryRun,
      cohortSize: 0,
      ...(dryRun ? { sample: [], sampleUrl: null } : { total: 0, results: emptyResults() }),
    });
  }

  // 2. Load those users with email + opt-out fields.
  const { data: usersData, error: usersErr } = await admin
    .from("users")
    .select("id, email, display_name, preferred_language, notification_settings")
    .in("id", ownerIds)
    .not("email", "is", null);
  if (usersErr) {
    console.error("[Feedback Outreach] users query failed:", usersErr.message);
    return errors.internal("Failed to load engaged users", "Feedback Outreach");
  }

  // 3. Pre-filter marketing/email opt-outs so the dry-run count is honest.
  //    (dispatchEmail re-checks this authoritatively on the real send.)
  const eligible = ((usersData ?? []) as EngagedUser[]).filter((u) => {
    if (!u.email || typeof u.email !== "string") return false;
    const ns = (u.notification_settings ?? {}) as Record<string, unknown>;
    if (ns.marketingNotifications === false) return false;
    if (ns.emailNotifications === false) return false;
    return true;
  });

  // 4. Cap to the requested limit.
  const cohort = eligible.slice(0, limit);
  const cohortSize = cohort.length;

  // 5. Dry run — report and send nothing.
  if (dryRun) {
    const first = cohort[0];
    const sampleUrl = first
      ? buildFeedbackUrl(first.id, normalizeEmailLocale(first.preferred_language))
      : null;
    return apiSuccess({
      dryRun: true,
      cohortSize,
      sample: cohort.slice(0, 5).map((u) => u.email),
      sampleUrl,
    });
  }

  // 6. Real send. Sequential to be gentle on Resend's rate limit. Each user
  //    is wrapped in try/catch so one failure never aborts the batch.
  const results = emptyResults();
  for (const user of cohort) {
    try {
      const firstName = firstNameOf(user.display_name);
      const locale = normalizeEmailLocale(user.preferred_language);
      const feedbackUrl = buildFeedbackUrl(user.id, locale);

      const outcome: SendOutcome = await dispatchEmail({
        recipientEmail: user.email,
        recipientUserId: user.id,
        template: {
          id: "feedback_outreach",
          props: { firstName, feedbackUrl },
        },
        idempotencyKey: `feedback_outreach_v1:${user.id}`,
        locale,
      });
      tally(results, outcome.status);
    } catch (err) {
      console.error(
        "[Feedback Outreach] dispatch threw for user",
        user.id,
        err instanceof Error ? err.message : err
      );
      results.failed++;
    }
  }

  return apiSuccess({
    dryRun: false,
    total: cohortSize,
    results,
  });
}

interface OutreachResults {
  sent: number;
  skipped_duplicate: number;
  skipped_disabled: number;
  skipped_suppressed: number;
  skipped_no_key: number;
  failed: number;
}

function emptyResults(): OutreachResults {
  return {
    sent: 0,
    skipped_duplicate: 0,
    skipped_disabled: 0,
    skipped_suppressed: 0,
    skipped_no_key: 0,
    failed: 0,
  };
}

function tally(results: OutreachResults, status: SendOutcome["status"]): void {
  switch (status) {
    case "sent":
      results.sent++;
      break;
    case "skipped_duplicate":
      results.skipped_duplicate++;
      break;
    case "skipped_disabled":
      results.skipped_disabled++;
      break;
    case "skipped_suppressed":
      results.skipped_suppressed++;
      break;
    case "skipped_no_key":
      results.skipped_no_key++;
      break;
    case "failed":
      results.failed++;
      break;
  }
}
