/**
 * Pre-send audit: render EVERY queued lifecycle email against real production
 * data and assert it is correct. Sends nothing.
 *
 *   npx tsx scripts/audit-queued-emails.mts            # every pending row
 *   LIMIT=50 npx tsx scripts/audit-queued-emails.mts   # first 50
 *   VERBOSE=1 ...                                      # print every email
 *
 * WHY THIS EXISTS
 * ---------------
 * The unit tests prove buildContextBlocks behaves on fixtures I wrote. They
 * cannot tell you whether the 699 emails actually sitting in the queue say
 * the right thing to the right person, because they never touch a real row.
 * Those are different claims and only this one matters before a send.
 *
 * The failure that motivated it was real: a review email announced "Lisbon"
 * and then listed the Louvre, because the fixture's destination and its
 * itinerary were two independent constants. That could not happen in
 * production — the cron reads both from the same row — but "could not happen"
 * is an argument, and an argument is not evidence. This produces evidence.
 *
 * THE CENTRAL CHECK IS CONTAINMENT
 * --------------------------------
 * For every line of enrichment rendered into an email, the text must appear
 * verbatim in THAT TRIP'S OWN jsonb. If a Paris activity ever reached a
 * Lisbon email, containment fails loudly. It is the one assertion that
 * directly answers "are we mixing trips up".
 *
 * FIDELITY TO THE CRON
 * --------------------
 * This imports the same buildContextBlocks, the same templates and the same
 * resolveLocale the cron uses, and resolves copy from the same message files
 * through next-intl's createTranslator. It deliberately does NOT re-implement
 * any of that logic — a checker that reimplements what it checks proves only
 * that two copies of a mistake agree.
 *
 * The one thing it cannot reproduce is dispatchEmail's consent and
 * suppression gating, which is DB state rather than rendering. Those are
 * reported separately per row so a "would be suppressed anyway" row is not
 * counted as a rendering problem.
 */

import { createClient } from "@supabase/supabase-js";
import { createTranslator } from "next-intl";
import { render } from "@react-email/render";
import { readFileSync } from "fs";
import { join } from "path";

import * as TripReminderMod from "../lib/email/templates/TripReminder";
import * as TripFollowupMod from "../lib/email/templates/TripFollowup";
import * as TripContextMod from "../lib/email/trip-context";
import * as LocaleMod from "../lib/email/reminder-locale";
import * as VerifyMod from "../lib/email/verify-render";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TR = (TripReminderMod as any).default;
const TripReminderEmail = TR.default;
const tripReminderSubject = TR.tripReminderSubject;
const TF = (TripFollowupMod as any).default;
const TripFollowupEmail = TF.default;
const TERMINAL_FOLLOWUP_SLOTS = TF.TERMINAL_FOLLOWUP_SLOTS;
const TC = (TripContextMod as any).default ?? TripContextMod;
const buildContextBlocks = TC.buildContextBlocks;
const VF = (VerifyMod as any).default ?? VerifyMod;
const verifyRenderedEmail = VF.verifyRenderedEmail;
const contextLines = VF.contextLines;
const LC = (LocaleMod as any).default ?? LocaleMod;
const resolveLocale = LC.resolveLocale;
const formatDateRange = LC.formatDateRange;

const ROOT = process.cwd();
const APP = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
const LIMIT = Number(process.env.LIMIT || 0);
const VERBOSE = Boolean(process.env.VERBOSE);

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Source it from .env.local before running.`);
    process.exit(1);
  }
  return v;
}

const supabase = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const LOCALES = ["en", "es", "it", "pt"] as const;
const messagesByLocale: Record<string, any> = {};
for (const l of LOCALES) {
  messagesByLocale[l] = {
    common: JSON.parse(readFileSync(join(ROOT, "messages", l, "common.json"), "utf8")),
  };
}

const isFollowup = (slot: string) => slot.startsWith("followup_");

type Finding = { level: "FAIL" | "WARN"; check: string; detail: string };

async function main() {
  let q = supabase
    .from("scheduled_notifications")
    .select("id, user_id, trip_id, slot, scheduled_for")
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true });
  if (LIMIT) q = q.limit(LIMIT);

  const { data: rows, error } = await q;
  if (error) {
    console.error("queue read failed:", error.message);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log("No pending rows to audit.");
    return;
  }

  console.log(`Auditing ${rows.length} queued emails against production data.\n`);

  /**
   * Independent read on what language each recipient actually browses in.
   *
   * A rendering audit alone cannot catch the worst localisation bug, because
   * an English email to a Spanish speaker renders perfectly — every string in
   * place, every link right, and completely wrong for the reader. This is the
   * only check here that looks at whether the message suits the person.
   *
   * It found the real thing: all 478 users were stored as preferred_language
   * 'en' while 36% of human traffic sits on /es, /it and /pt.
   */
  const hintByUser = new Map<string, { inferred: string; confident: boolean; share: number }>();
  const { data: hints, error: hintErr } = await supabase.rpc("user_inferred_ui_locale", {
    p_min_views: 3,
    p_min_share: 0.6,
  });
  if (hintErr) {
    console.log(`  (language cross-check unavailable: ${hintErr.message})\n`);
  } else {
    for (const h of (hints ?? []) as any[]) {
      hintByUser.set(h.user_id, {
        inferred: h.inferred,
        confident: h.confident,
        share: Number(h.share),
      });
    }
  }

  const findings: Array<Finding & { row: string; slot: string; trip: string }> = [];
  const stats = {
    rendered: 0,
    withEnrichment: 0,
    bySlot: {} as Record<string, number>,
    byLocale: {} as Record<string, number>,
    wouldSuppress: 0,
    enrichedLines: 0,
  };

  for (const row of rows) {
    const add = (level: Finding["level"], check: string, detail: string) =>
      findings.push({ level, check, detail, row: row.id, slot: row.slot, trip: row.trip_id });

    // Same projection the cron uses.
    const { data: tripRaw, error: tripErr } = await supabase
      .from("trips")
      .select(
        "id, title, start_date, end_date, reminders_muted, trip_meta, itinerary"
      )
      .eq("id", row.trip_id)
      .maybeSingle();

    if (tripErr || !tripRaw) {
      add("FAIL", "trip_load", tripErr?.message ?? "trip missing");
      continue;
    }
    const trip = tripRaw as any;

    const { data: user } = await supabase
      .from("users")
      .select("email, preferred_language, notification_settings")
      .eq("id", row.user_id)
      .maybeSingle();

    if (!user?.email) {
      add("WARN", "no_recipient", "user has no email — will be suppressed, not sent");
      stats.wouldSuppress++;
      continue;
    }

    // Consent, mirrored from lib/email/send.ts. Reported, not failed: a
    // suppressed row is correct behaviour, not a rendering defect.
    const ns = (user.notification_settings ?? {}) as Record<string, unknown>;
    const key = isFollowup(row.slot) ? "marketingNotifications" : "tripReminders";
    if (ns.emailNotifications === false || ns[key] === false) {
      stats.wouldSuppress++;
      if (VERBOSE) console.log(`  · ${row.slot} suppressed by ${key} for ${trip.id}`);
      continue;
    }

    const locale = resolveLocale(user.preferred_language);
    stats.byLocale[locale] = (stats.byLocale[locale] ?? 0) + 1;

    // Would this land in a language the recipient does not browse in?
    // A WARN, not a FAIL — the signal is a heuristic over page-view prefixes,
    // and it must not be able to block a send on its own.
    const hint = hintByUser.get(row.user_id);
    if (hint?.confident && hint.inferred !== locale) {
      add(
        "WARN",
        "language_mismatch",
        `sending in "${locale}" but ${Math.round(hint.share * 100)}% of their page views are "${hint.inferred}"`
      );
    }
    stats.bySlot[row.slot] = (stats.bySlot[row.slot] ?? 0) + 1;

    const messages = messagesByLocale[locale];
    const rootNs = isFollowup(row.slot) ? "common.tripFollowupEmail" : "common.tripReminderEmail";
    const t = createTranslator({ locale, messages, namespace: `${rootNs}.${row.slot}` });
    const rootT = createTranslator({ locale, messages, namespace: rootNs });
    const ctxT = createTranslator({ locale, messages, namespace: "common.emailContext" });

    // Destination, exactly as the cron derives it.
    const destination =
      (trip.title || "").replace(/\s+Trip\s*$/i, "").trim() || "your trip";
    if (destination === "your trip") {
      add("FAIL", "destination", `unusable title ${JSON.stringify(trip.title)}`);
    }

    const heading = t("heading", { destination });
    const body = t("body", { destination });
    const ctaLabel = isFollowup(row.slot) ? t("cta") : rootT("cta");
    const finalNote = TERMINAL_FOLLOWUP_SLOTS.has(row.slot) ? rootT("finalNote") : undefined;

    const meta = (trip.trip_meta ?? {}) as any;
    const day1 = Array.isArray(trip.itinerary) ? trip.itinerary[0] : undefined;
    const blocks = buildContextBlocks(
      row.slot,
      {
        weatherNote: meta.weather_note,
        highlights: meta.highlights,
        packingSuggestions: meta.packing_suggestions,
        day1,
      },
      {
        weather: ctxT("weather"),
        packing: ctxT("packing"),
        goingFor: ctxT("goingFor"),
        dayOne: ctxT("dayOne"),
        today: ctxT("today"),
        yourHighlights: ctxT("yourHighlights"),
      }
    );

    // Every enrichment string that legitimately belongs to this trip. The
    // shared verifier checks each rendered line against these — a line
    // borrowed from any other trip fails containment.
    //
    // Built from the VALUES, not JSON.stringify of the row: stringify escapes
    // embedded quotes, so a weather note containing one would never contain
    // its own text.
    const ownStrings: string[] = [
      typeof meta.weather_note === "string" ? meta.weather_note : "",
      ...(Array.isArray(meta.highlights) ? meta.highlights : []),
      ...(Array.isArray(meta.packing_suggestions) ? meta.packing_suggestions : []),
      ...(Array.isArray(day1?.activities)
        ? day1.activities.flatMap((a: any) => [a?.name, a?.start_time, a?.time_slot])
        : []),
    ]
      .filter((s: unknown): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    stats.enrichedLines += contextLines(blocks).length;
    if (blocks.length) stats.withEnrichment++;

    const tripUrl = `${APP}/trips/${trip.id}?slot=${row.slot}`;
    const ctaUrl = isFollowup(row.slot)
      ? row.slot === "followup_return_3d"
        ? tripUrl
        : `${APP}/trips/new?slot=${row.slot}`
      : tripUrl;

    const props: any = isFollowup(row.slot)
      ? { slot: row.slot, destination, heading, body, ctaLabel, ctaUrl, finalNote,
          locale, contextBlocks: blocks }
      : { slot: row.slot, destination, heading, body, ctaLabel, tripUrl, locale,
          tripDates: formatDateRange(trip.start_date, trip.end_date, locale),
          contextBlocks: blocks };

    let html = "";
    try {
      html = await render(
        isFollowup(row.slot) ? TripFollowupEmail(props) : TripReminderEmail(props)
      );
    } catch (err) {
      add("FAIL", "render", err instanceof Error ? err.message : String(err));
      continue;
    }
    stats.rendered++;

    // The SHARED subject builders, not a local copy of the rule — a checker
    // that reimplements what it checks only proves two copies of a mistake
    // agree. This exact duplication drifted once already.
    const subject = isFollowup(row.slot)
      ? heading
      : tripReminderSubject({ heading, destination });

    // THE shared verifier — the exact function the cron runs inline before
    // every dispatch. Not a copy of its rules: a checker that reimplements
    // what it checks only proves two copies of a mistake agree, and this
    // codebase has already paid for that once this week.
    for (const d of verifyRenderedEmail({
      subject,
      html,
      destination,
      tripId: trip.id,
      contextBlocks: blocks,
      ownStrings,
    })) {
      add(d.severity === "block" ? "FAIL" : "WARN", d.check, d.detail);
    }

    if (VERBOSE) {
      console.log(`  ${row.slot.padEnd(20)} ${locale}  ${subject}`);
      for (const b of blocks) {
        console.log(`      [${b.label}] ${b.note ?? (b.items ?? []).map((i: any) => i.text).join(" | ")}`);
      }
    }
  }

  // ---------------------------- report ----------------------------
  const fails = findings.filter((f) => f.level === "FAIL");
  const warns = findings.filter((f) => f.level === "WARN");

  console.log("\n" + "=".repeat(66));
  console.log(`Rendered:            ${stats.rendered}`);
  console.log(`With enrichment:     ${stats.withEnrichment}  (${stats.enrichedLines} enriched lines checked for containment)`);
  console.log(`Would be suppressed: ${stats.wouldSuppress}  (consent / no email — correct behaviour)`);
  console.log(`By slot:             ${JSON.stringify(stats.bySlot)}`);
  console.log(`By locale:           ${JSON.stringify(stats.byLocale)}`);
  console.log("=".repeat(66));

  const group = (list: typeof findings) => {
    const by: Record<string, typeof findings> = {};
    for (const f of list) (by[f.check] ??= []).push(f);
    return by;
  };

  if (warns.length) {
    console.log(`\n${warns.length} WARNING(S):`);
    for (const [check, list] of Object.entries(group(warns))) {
      console.log(`  ${check}: ${list.length}`);
      for (const f of list.slice(0, 5)) console.log(`    trip ${f.trip} ${f.slot}: ${f.detail}`);
      if (list.length > 5) console.log(`    …and ${list.length - 5} more`);
    }
  }

  if (fails.length) {
    console.log(`\n${fails.length} FAILURE(S):`);
    for (const [check, list] of Object.entries(group(fails))) {
      console.log(`  ${check}: ${list.length}`);
      for (const f of list.slice(0, 10)) console.log(`    trip ${f.trip} ${f.slot}: ${f.detail}`);
      if (list.length > 10) console.log(`    …and ${list.length - 10} more`);
    }
    console.log("\nAUDIT FAILED — do not deploy the cascade until these are resolved.");
    process.exit(1);
  }

  console.log("\nAUDIT PASSED — every queued email renders correctly and every");
  console.log("enriched line traces back to its own trip.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
