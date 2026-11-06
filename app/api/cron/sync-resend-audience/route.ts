import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { isMarketingOptedOut } from "@/lib/email/preferences";
import { refuseUnlessCron } from "@/lib/api/cron-auth";
import { readWholeTable } from "@/lib/supabase/read-all-rows";

/**
 * Weekly cron: keeps the Resend audience in step with who may be emailed, and
 * the account under the contact limit of Resend's plan.
 *
 * The audience is whoever was active most recently, from users +
 * email_subscribers, up to AUDIENCE_CEILING, leaving out anyone opted out.
 * In this order, so a run out of time still carries every opt-out:
 *   1. Unsubscribes made in Resend (one-click / List-Unsubscribe) come back
 *      into users.notification_settings. Removing a contact loses its flag, so
 *      this goes before any removal.
 *   2. Opt-outs made in the app go to Resend, so a contact whose removal then
 *      fails can't stay subscribed.
 *   3. Contacts outside the audience are removed from the account. Only from
 *      Resend: our own tables keep the person and their preferences, and they
 *      come back when they next sign in.
 *   4. Missing contacts are added.
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
 * because we don't need to be incremental-down-to-the-minute, and
 * weekly keeps the Resend API call volume tiny.
 *
 * Auth: CRON_SECRET via Bearer header — same pattern as the other
 * cron routes (refresh-activity-index, scheduled-notifications,
 * recompute-editors-picks).
 *
 * Safety: never sends or modifies any email content. Both opt-out directions
 * only ever ADD an opt-out, never remove one, so an unsubscribe can never be
 * silently reversed. users.notification_settings stays the single source of
 * truth for who may be emailed. Someone opted out is never added back.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/sync-resend-audience
 */

type AudienceUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  preferred_language: string | null;
  notification_settings: Record<string, unknown> | null;
  created_at: string | null;
};

// Under the plan's contact limit, which counts the whole account, not just this audience.
const AUDIENCE_CEILING = 950;

// Removing and adding contacts stop after this; vercel.json gives the function 300 s.
const WRITE_BUDGET_MS = 240_000;

const timeOf = (at: string | null | undefined) => (at ? Date.parse(at) : 0);

/** When each account last signed in. Only Supabase Auth keeps this. */
async function lastSignIns(svc: ReturnType<typeof createAdminClient>) {
  const signedIn = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { signedIn, error };
    if (data.users.length === 0) return { signedIn, error: null };
    for (const u of data.users) {
      if (u.last_sign_in_at) signedIn.set(u.id, u.last_sign_in_at);
    }
  }
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
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

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
  const svc = createAdminClient();

  // Step 1: pull Supabase user list + waitlist subscribers.
  const { data: users, error: usersErr } = await readWholeTable<AudienceUser>(
    svc,
    "users",
    "id, email, display_name, preferred_language, notification_settings, created_at",
    (rows) => rows.not("email", "is", null)
  );
  if (usersErr) {
    console.error("[sync-resend-audience] users query failed:", usersErr);
    return NextResponse.json(
      { error: "Users query failed", detail: usersErr.message },
      { status: 500 }
    );
  }

  const { data: subs, error: subsErr } = await readWholeTable<{
    id: string;
    email: string | null;
    created_at: string | null;
    unsubscribed_at: string | null;
  }>(svc, "email_subscribers", "id, email, created_at, unsubscribed_at");
  if (subsErr) {
    console.error("[sync-resend-audience] subscribers query failed:", subsErr);
    return NextResponse.json(
      { error: "Subscribers query failed", detail: subsErr.message },
      { status: 500 }
    );
  }

  const { signedIn, error: signInsErr } = await lastSignIns(svc);
  if (signInsErr) {
    console.error("[sync-resend-audience] sign-ins query failed:", signInsErr);
    return NextResponse.json(
      { error: "Sign-ins query failed", detail: signInsErr.message },
      { status: 500 }
    );
  }

  // Merge into a single deduped contact map.
  type Contact = {
    email: string;
    firstName?: string;
    locale?: string;
    optedOut: boolean;
    lastActiveAt: number;
  };
  const byEmail = new Map<string, Contact>();

  for (const s of subs ?? []) {
    if (!s.email) continue;
    const email = String(s.email).trim().toLowerCase();
    if (!email || isExcluded(email)) continue;
    // A waitlist subscriber with unsubscribed_at set has opted out.
    byEmail.set(email, {
      email,
      optedOut: Boolean(s.unsubscribed_at),
      lastActiveAt: timeOf(s.created_at),
    });
  }

  for (const u of users ?? []) {
    if (!u.email) continue;
    const email = String(u.email).trim().toLowerCase();
    if (!email || isExcluded(email)) continue;
    // Marketing opt-out lives in users.notification_settings: either the
    // marketing switch or the master "Send me emails" switch turned off.
    // Only an explicit `false` is an opt-out; a missing key defaults to opted-in.
    const optedOut = isMarketingOptedOut(u.notification_settings);
    // users overrides waitlist (richer profile data).
    byEmail.set(email, {
      email,
      firstName: firstName(u.display_name),
      locale: (u.preferred_language as string | undefined) || undefined,
      optedOut,
      lastActiveAt: timeOf(signedIn.get(u.id) ?? u.created_at),
    });
  }

  // Step 2: list existing audience contacts to diff.
  //
  // The previous comment here asserted the endpoint "returns the full audience
  // in one call (no pagination required for our scale)". That is an assumption
  // about someone else's default page size, and it is the kind that fails
  // silently and gradually: contacts past the first page simply never appear
  // in `existingState`, so the diff re-creates them and, worse, never
  // reconciles their opt-out. Someone who unsubscribed keeps receiving mail.
  //
  // So the count is no longer assumed. If the response says there is more, we
  // say so loudly rather than quietly syncing a prefix of the audience.
  const existing = await resend.contacts.list({ audienceId });
  if (existing.error) {
    console.error("[sync-resend-audience] list failed:", existing.error);
    return NextResponse.json(
      { error: "List contacts failed", detail: existing.error.message },
      { status: 500 }
    );
  }

  const listed = (existing.data?.data ?? []) as unknown[];
  const hasMore = Boolean(
    (existing.data as unknown as { has_more?: boolean } | null)?.has_more
  );
  if (hasMore) {
    // Refuse rather than half-sync. A partial diff would resurrect
    // unsubscribed contacts, which is the one outcome worse than not syncing.
    console.error(
      "[sync-resend-audience] audience is paginated — refusing to sync a prefix",
      { listed: listed.length }
    );
    return NextResponse.json(
      {
        error: "Audience larger than one page",
        detail:
          `Resend returned ${listed.length} contacts with has_more=true. ` +
          "Syncing only the first page would re-create contacts that are not " +
          "in it and would not reconcile their opt-outs. Add pagination here " +
          "before this audience grows further.",
      },
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

  // Step 3: bring unsubscribes made in Resend (one-click / List-Unsubscribe,
  // which land there, not in our DB) back into users.notification_settings.
  // Idempotent + self-healing — needs no webhook and no Resend dashboard config,
  // so it can't silently break the way an unsubscribed-event subscription can.
  // A contact whose opt-out couldn't be written stays until a later run can:
  // its flag in Resend is the only record of it.
  let backSynced = 0;
  const notRecorded = new Set<string>();
  for (const u of users ?? []) {
    const email = String(u.email ?? "").trim().toLowerCase();
    if (existingState.get(email) !== true) continue;
    const contact = byEmail.get(email);
    if (contact) contact.optedOut = true;
    const ns = (u.notification_settings ?? {}) as Record<string, unknown>;
    if (ns.marketingNotifications === false) continue; // already opted out in DB
    const { error: backErr } = await svc
      .from("users")
      .update({
        notification_settings: { ...ns, marketingNotifications: false },
      })
      .eq("id", u.id);
    if (backErr) notRecorded.add(email);
    else backSynced++;
  }

  // Step 4: flag EXISTING contacts that opted out in the app but are still
  // subscribed in Resend. One-directional ON PURPOSE — only ever subscribed ->
  // unsubscribed — so a Resend unsubscribe can never be reversed by this cron.
  const known = [...byEmail.values()];
  let reconciled = 0;
  for (const c of known) {
    if (!c.optedOut) continue;
    if (!existingEmails.has(c.email)) continue;
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

  const wanted = known
    .filter((c) => !c.optedOut)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, AUDIENCE_CEILING);
  const wantedEmails = new Set(wanted.map((c) => c.email));
  const toRemove = [...existingEmails].filter(
    (email) => !wantedEmails.has(email) && !notRecorded.has(email)
  );
  const toCreate = wanted.filter((c) => !existingEmails.has(c.email));

  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];
  const attempt = async (
    email: string,
    write: () => Promise<{ error: { message: string } | null }>
  ) => {
    try {
      const { error } = await write();
      if (!error) return true;
      errors.push({ email, error: error.message });
    } catch (err) {
      errors.push({ email, error: err instanceof Error ? err.message : "call threw" });
    }
    failed++;
    return false;
  };

  // Step 5: remove, making room before adding. Sequential rather than
  // Promise.all to stay under Resend's per-API-key rate limit (10 req/s default).
  // A backlog can outlast one run, so this and the next step stop at a deadline
  // inside the function limit, and the next run does the rest.
  //
  // Without an audienceId: with one, Resend only takes the contact out of that
  // audience, reports it deleted, and the contact still counts against the limit.
  let removed = 0;
  let removalsDeferred = 0;
  for (const [i, email] of toRemove.entries()) {
    if (Date.now() - startedAt > WRITE_BUDGET_MS) {
      removalsDeferred = toRemove.length - i;
      break;
    }
    if (await attempt(email, () => resend.contacts.remove({ email }))) removed++;
  }

  // Step 6: add whoever is missing.
  let created = 0;
  let deferred = 0;
  for (const [i, c] of toCreate.entries()) {
    if (Date.now() - startedAt > WRITE_BUDGET_MS) {
      deferred = toCreate.length - i;
      break;
    }
    const added = await attempt(c.email, () =>
      resend.contacts.create({ email: c.email, firstName: c.firstName, audienceId })
    );
    if (added) created++;
  }

  // Trim error log so a runaway error case doesn't blow the response
  // size limit. First 10 errors gives us enough signal to debug.
  const truncatedErrors = errors.slice(0, 10);

  console.log("[sync-resend-audience]", {
    totalDbUsers: users?.length ?? 0,
    totalWaitlist: subs?.length ?? 0,
    desired: wanted.length,
    existing: existingEmails.size,
    toRemove: toRemove.length,
    removed,
    removalsDeferred,
    toCreate: toCreate.length,
    created,
    failed,
    deferred,
    reconciledOptOuts: reconciled,
    reverseBackSynced: backSynced,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    success: true,
    summary: {
      totalDbUsers: users?.length ?? 0,
      totalWaitlist: subs?.length ?? 0,
      desired: wanted.length,
      existing: existingEmails.size,
      toRemove: toRemove.length,
      removed,
      removalsDeferred,
      toCreate: toCreate.length,
      created,
      failed,
      deferred,
      reconciledOptOuts: reconciled,
      reverseBackSynced: backSynced,
    },
    errors: truncatedErrors,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
