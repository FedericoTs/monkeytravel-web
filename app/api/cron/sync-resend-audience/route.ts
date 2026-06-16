import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Resend } from "resend";

/**
 * Weekly cron — incremental sync of new Supabase users into the Resend
 * audience so future broadcast campaigns reach the full user base.
 *
 * Follow-up to task #323: a one-off bootstrap imported 118 contacts via
 * scripts/export-all-users-to-resend.mts. This cron keeps it in sync as
 * new users sign up — without it the audience drifts behind and
 * marketing sends miss anyone who joined since the bootstrap.
 *
 * Strategy: list existing audience contacts → diff against
 * users + email_subscribers → POST the missing ones (with the correct
 * `unsubscribed` flag derived from the user's marketing preference), then
 * reconcile any EXISTING contact that has since opted out in-app but is
 * still flagged subscribed in Resend. Reconciliation is one-directional —
 * only subscribed → unsubscribed, never the reverse — so a native Resend
 * one-click unsubscribe is never silently re-subscribed. We never delete
 * contacts.
 *
 * Exclusions match scripts/export-all-users-to-resend.mts so the bootstrap
 * and the cron treat the same population identically:
 *   - loadtest+% (synthetic users)
 *   - %@example.com / %@test.local
 *   - emails containing "+test" / "test+"
 *
 * Soft-skip when RESEND_API_KEY or RESEND_AUDIENCE_ID is missing —
 * mirrors the lib/email/client.ts pattern. Cron returns 200 with
 * skipped=true so Vercel doesn't alarm on every run pre-launch.
 *
 * Schedule: weekly Monday 06:00 UTC (vercel.json). Cadence is slow
 * because user growth is also slow (~10-20 signups/week); we don't
 * need to be incremental-down-to-the-minute, and weekly keeps the
 * Resend API call volume tiny (one list + N inserts).
 *
 * Auth: CRON_SECRET via Bearer header — same pattern as the other
 * cron routes (refresh-activity-index, scheduled-notifications,
 * recompute-editors-picks).
 *
 * Safety: never sends or modifies any email content. Only mutates the
 * Resend audience-contacts list, and only ever ADDS suppressions
 * (subscribed → unsubscribed) — it can never re-subscribe an opted-out
 * contact, so the marketing preference in users.notification_settings is
 * the single source of truth for who may be emailed.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/sync-resend-audience
 */

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for cron");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isExcluded(email: string): boolean {
  const e = email.toLowerCase();
  if (e.startsWith("loadtest+")) return true;
  if (e.endsWith("@example.com")) return true;
  if (e.endsWith("@test.local")) return true;
  if (e.includes("+test")) return true;
  if (e.includes("test+")) return true;
  return false;
}

function firstName(displayName?: string | null): string | undefined {
  if (!displayName) return undefined;
  const trimmed = displayName.trim();
  if (!trimmed) return undefined;
  const first = trimmed.split(/\s+/)[0];
  if (!first) return undefined;
  // Skip email-prefix-looking strings (contains dot, or all-lowercase >10 chars)
  const looksLikeHandle =
    /\./.test(first) ||
    /^[a-z]+\d+$/.test(first) ||
    (/^[a-z0-9]+$/.test(first) && first.length > 10);
  if (looksLikeHandle) return undefined;
  return first;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return unauthorized();
  if (auth !== `Bearer ${secret}`) return unauthorized();

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    // Pre-launch state — Resend not configured yet. Soft-skip with 200
    // so Vercel's cron failure alarm doesn't fire every week.
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: !apiKey
        ? "RESEND_API_KEY not set"
        : "RESEND_AUDIENCE_ID not set",
      timestamp: new Date().toISOString(),
    });
  }

  const startedAt = Date.now();
  const resend = new Resend(apiKey);
  const svc = serviceClient();

  // Step 1: pull Supabase user list + waitlist subscribers.
  const { data: users, error: usersErr } = await svc
    .from("users")
    .select("email, display_name, preferred_language, notification_settings")
    .not("email", "is", null);
  if (usersErr) {
    console.error("[sync-resend-audience] users query failed:", usersErr);
    return NextResponse.json(
      { error: "Users query failed", detail: usersErr.message },
      { status: 500 }
    );
  }

  const { data: subs } = await svc
    .from("email_subscribers")
    .select("email, unsubscribed_at");

  // Merge into a single deduped contact map.
  type Contact = {
    email: string;
    firstName?: string;
    locale?: string;
    optedOut: boolean;
  };
  const byEmail = new Map<string, Contact>();

  for (const s of subs ?? []) {
    if (!s.email) continue;
    const email = String(s.email).trim().toLowerCase();
    if (!email || isExcluded(email)) continue;
    // A waitlist subscriber with unsubscribed_at set has opted out.
    byEmail.set(email, { email, optedOut: Boolean(s.unsubscribed_at) });
  }

  for (const u of users ?? []) {
    if (!u.email) continue;
    const email = String(u.email).trim().toLowerCase();
    if (!email || isExcluded(email)) continue;
    // Marketing opt-out lives in users.notification_settings.marketingNotifications.
    // Only an explicit `false` is an opt-out; a missing key defaults to opted-in.
    const ns = (u.notification_settings ?? {}) as Record<string, unknown>;
    const optedOut = ns.marketingNotifications === false;
    // users overrides waitlist (richer profile data).
    byEmail.set(email, {
      email,
      firstName: firstName(u.display_name),
      locale: (u.preferred_language as string | undefined) || undefined,
      optedOut,
    });
  }

  const desiredContacts = [...byEmail.values()];

  // Step 2: list existing audience contacts to diff. Resend's list
  // endpoint returns the full audience in one call (no pagination
  // required for our scale — under 10K contacts).
  const existing = await resend.contacts.list({ audienceId });
  if (existing.error) {
    console.error("[sync-resend-audience] list failed:", existing.error);
    return NextResponse.json(
      { error: "List contacts failed", detail: existing.error.message },
      { status: 500 }
    );
  }
  // email -> current Resend unsubscribed state, so we can both diff for
  // creation AND reconcile opt-outs on contacts that already exist.
  const existingState = new Map<string, boolean>();
  for (const c of existing.data?.data ?? []) {
    const e = (c.email ?? "").toLowerCase();
    if (e) existingState.set(e, c.unsubscribed === true);
  }
  const existingEmails = new Set<string>(existingState.keys());

  const toCreate = desiredContacts.filter((c) => !existingEmails.has(c.email));

  // Step 3: insert the missing contacts. Sequential rather than
  // Promise.all to stay under Resend's per-API-key rate limit
  // (10 req/s default). With ~10-20 new signups/week we never come
  // close to the 60s function cap.
  let created = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (const c of toCreate) {
    try {
      const res = await resend.contacts.create({
        email: c.email,
        firstName: c.firstName,
        // Respect the user's marketing opt-out at creation time so we never
        // import an already-opted-out user as a subscribed contact.
        unsubscribed: c.optedOut,
        audienceId,
      });
      if (res.error) {
        failed++;
        errors.push({ email: c.email, error: res.error.message });
      } else {
        created++;
      }
    } catch (err) {
      failed++;
      errors.push({
        email: c.email,
        error: err instanceof Error ? err.message : "create threw",
      });
    }
  }

  // Step 3b: reconcile EXISTING contacts that have opted out in-app but are
  // still flagged subscribed in Resend (e.g. they unsubscribed after the
  // bootstrap import). One-directional ON PURPOSE — we only ever flip
  // subscribed -> unsubscribed, never the reverse — so a native Resend
  // one-click unsubscribe can never be silently re-subscribed by this cron.
  // This + the create-time `unsubscribed: c.optedOut` above make app-side
  // marketing opt-outs propagate to Resend on every run.
  let reconciled = 0;
  for (const c of desiredContacts) {
    if (!c.optedOut) continue;
    if (!existingEmails.has(c.email)) continue; // newly created ones were already set correctly
    if (existingState.get(c.email) === true) continue; // already unsubscribed in Resend
    try {
      const res = await resend.contacts.update({
        audienceId,
        email: c.email,
        unsubscribed: true,
      });
      if (!res.error) reconciled++;
    } catch {
      // best-effort; surfaced via the reconciled count in the summary
    }
  }

  // Trim error log so a runaway error case doesn't blow the response
  // size limit. First 10 errors gives us enough signal to debug.
  const truncatedErrors = errors.slice(0, 10);

  console.log("[sync-resend-audience]", {
    totalDbUsers: users?.length ?? 0,
    totalWaitlist: subs?.length ?? 0,
    desired: desiredContacts.length,
    existing: existingEmails.size,
    toCreate: toCreate.length,
    created,
    failed,
    reconciledOptOuts: reconciled,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    success: true,
    summary: {
      totalDbUsers: users?.length ?? 0,
      totalWaitlist: subs?.length ?? 0,
      desired: desiredContacts.length,
      existing: existingEmails.size,
      toCreate: toCreate.length,
      created,
      failed,
      reconciledOptOuts: reconciled,
    },
    errors: truncatedErrors,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
