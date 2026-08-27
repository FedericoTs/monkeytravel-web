/**
 * One-off: render every email template with sample data and send each to
 * a test inbox via Resend. NOT part of the app build — run manually:
 *
 *   RESEND_API_KEY=re_... TEST_TO=you@example.com npx tsx scripts/send-test-emails.mts
 *
 * Bypasses lib/email/send.ts (no DB / idempotency / opt-out) on purpose:
 * this validates rendering + brand design + deliverability only.
 */

import { render } from "@react-email/render";
import { Resend } from "resend";
import { readFileSync } from "fs";
import { join } from "path";

import * as InviteMod from "../lib/email/templates/Invite";
import * as VoteCastMod from "../lib/email/templates/VoteCast";
import * as TripReminderMod from "../lib/email/templates/TripReminder";
import * as TripFollowupMod from "../lib/email/templates/TripFollowup";
import * as TripContextMod from "../lib/email/trip-context";
import * as ConfirmSignupMod from "../lib/email/templates/ConfirmSignup";
import * as AuthActionMod from "../lib/email/templates/AuthAction";
import * as BlogDigestMod from "../lib/email/templates/BlogDigest";
import * as BlogAnnounceMod from "../lib/email/templates/BlogAnnounce";
import * as BlogApiMod from "../lib/blog/api";

// tsx transpiles these .tsx files to CJS, so the ESM namespace's `.default`
// is the whole module.exports object ({ default: Component, <textFn> }).
// Unwrap one level to reach the real bindings.
/* eslint-disable @typescript-eslint/no-explicit-any */
const Invite = (InviteMod as any).default;
const VoteCast = (VoteCastMod as any).default;
const TripReminder = (TripReminderMod as any).default;
const Confirm = (ConfirmSignupMod as any).default;

const InviteEmail = Invite.default;
const inviteEmailText = Invite.inviteEmailText;
const VoteCastEmail = VoteCast.default;
const voteCastEmailText = VoteCast.voteCastEmailText;
const TripReminderEmail = TripReminder.default;
const tripReminderEmailText = TripReminder.tripReminderEmailText;
const tripReminderSubject = TripReminder.tripReminderSubject;
const TripFollowup = (TripFollowupMod as any).default;
const TripFollowupEmail = TripFollowup.default;
const tripFollowupEmailText = TripFollowup.tripFollowupEmailText;
const TERMINAL_FOLLOWUP_SLOTS = TripFollowup.TERMINAL_FOLLOWUP_SLOTS;
// Plain .ts, so tsx may or may not wrap it — accept either shape.
const TripContext = (TripContextMod as any).default ?? TripContextMod;
const buildContextBlocks = TripContext.buildContextBlocks;
const ConfirmSignupEmail = Confirm.default;
const confirmSignupEmailText = Confirm.confirmSignupEmailText;

const AuthAction = (AuthActionMod as any).default;
const AuthActionEmail = AuthAction.default;
const authActionEmailText = AuthAction.authActionEmailText;
const authActionSubject = AuthAction.authActionSubject;

const BlogDigest = (BlogDigestMod as any).default;
const BlogDigestEmail = BlogDigest.default;
const blogDigestEmailText = BlogDigest.blogDigestEmailText;
const blogDigestSubject = BlogDigest.blogDigestSubject;

const BlogAnnounce = (BlogAnnounceMod as any).default;
const BlogAnnounceEmail = BlogAnnounce.default;
const blogAnnounceEmailText = BlogAnnounce.blogAnnounceEmailText;
const blogAnnounceSubject = BlogAnnounce.blogAnnounceSubject;

const blogApi = (BlogApiMod as any).default ?? BlogApiMod;
const getAllFrontmatter = blogApi.getAllFrontmatter;

const apiKey = process.env.RESEND_API_KEY;

/**
 * Recipients. Comma-separated TEST_TO wins; otherwise the admin allowlist
 * from lib/admin.ts, so "send the team a review set" needs no arguments.
 *
 * The old default was federicosciuca@droplab.com — which has been on
 * Resend's SUPPRESSION list as a hard bounce since 2026-05-30. Every test
 * send using the default was silently dropped by Resend and never reached
 * an inbox, while this script printed a message id and a tick. Suppressed
 * addresses are checked explicitly below rather than trusted to the
 * default, because that failure is invisible from here.
 */
const ADMIN_EMAILS = [
  "federicosciuca@gmail.com",
  "azzolina.francesca@gmail.com",
  "marinoenrico3@gmail.com",
];
const to = (process.env.TEST_TO || ADMIN_EMAILS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FROM = process.env.EMAIL_FROM || "MonkeyTravel <noreply@monkeytravel.app>";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "hello@monkeytravel.app";

if (!apiKey) {
  console.error("RESEND_API_KEY is required");
  process.exit(1);
}

const resend = new Resend(apiKey);
const APP = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
// Preview a specific locale: LOCALE=es | it (defaults to en).
const L = (process.env.LOCALE as "en" | "es" | "it") || "en";

// Pull the 3 newest real blog posts → digest cards (absolute image URLs).
const frontmatter: any[] = getAllFrontmatter(L);
const blogCards = frontmatter.slice(0, 3).map((fm) => ({
  title: fm.title,
  excerpt: fm.description,
  url: `${APP}/blog/${fm.slug}`,
  imageUrl: fm.image?.startsWith("http") ? fm.image : `${APP}${fm.image}`,
  category: fm.category,
  readingTime: fm.readingTime,
}));
const featured = blogCards[0];

type Job = {
  label: string;
  subject: string;
  element: React.ReactElement;
  text: string;
};

/**
 * The trip-lifecycle emails are built from the REAL shipping copy in
 * messages/<locale>/common.json, not from sample strings.
 *
 * This used to be one hardcoded trip_reminder job whose heading read "Two
 * weeks to go!" — the shipped copy is "Two weeks to go", and the body text
 * differed too. A design review of strings that do not exist in the product
 * is worse than no review: it certifies the wrong thing.
 *
 * Rendering from the message files also means a locale gap shows up here,
 * in a review inbox, instead of in a user's.
 */
const commonMessages = JSON.parse(
  readFileSync(join(process.cwd(), "messages", L, "common.json"), "utf8")
);
/**
 * ONE sample trip — destination and itinerary in a single object.
 *
 * These used to be two independent constants: DEST = "Lisbon" and a context
 * fixture copied from a real Paris row. The review set therefore announced
 * "Two weeks to go — Lisbon" and then listed the Louvre, which reads as the
 * feature pairing the wrong agenda with the wrong city.
 *
 * It never could in production — the cron reads the destination and the
 * itinerary from the SAME trips row, so they cannot disagree. It was purely
 * an artefact of the fixture, but an artefact that made a correct feature
 * look broken, which is the worst kind of thing to put in front of reviewers.
 *
 * Keeping them in one object is the fix: there is no longer a second place
 * to change.
 */
const SAMPLE_TRIP = {
  destination: "Paris",
  dates: "Sep 12 – Sep 15",
  /**
   * Enrichment copied verbatim from a REAL production trip row (read
   * 2026-08-27) rather than invented. Hand-written sample data flatters the
   * design; real generated copy is longer, less tidy, and occasionally
   * missing a field.
   */
  context: {
    weatherNote:
      "Expect mild spring weather with temperatures ranging from 10°C to 20°C, occasional rain, and long bright evenings.",
    highlights: [
      "Exploring the artistic treasures of the Louvre Museum and Musée d'Orsay.",
      "Enjoying a romantic Seine River cruise at sunset.",
      "Wandering through Montmartre at golden hour.",
    ],
    packingSuggestions: [
      "Light rain jacket",
      "Comfortable walking shoes",
      "Universal power adapter",
      "A scarf for the evenings",
    ],
    day1: {
      day_number: 1,
      theme: "Arrival and the Right Bank",
      activities: [
        { name: "Louvre Museum", start_time: "09:30" },
        { name: "Le Fumoir", start_time: "13:00" },
        { name: "Walk through Tuileries Garden and Place de la Concorde", start_time: "15:00" },
      ],
    },
  },
};

const DEST = SAMPLE_TRIP.destination;
// The cron interpolates via next-intl; here a plain substitution is enough
// and keeps the script free of the i18n runtime.
const fill = (s: string) => s.replace(/\{destination\}/g, DEST);

const reminderCopy = commonMessages.tripReminderEmail;
const followupCopy = commonMessages.tripFollowupEmail;
const contextLabels = commonMessages.emailContext;

/**
 * Block CONTENT stays English across all locales on purpose: the generator
 * writes trip content in the USER'S language, so in production a Spanish
 * user's blocks are Spanish. Only the headings come from
 * messages/<locale>/common.json — those are what a locale review checks.
 */
const ctxFor = (slot: string) =>
  buildContextBlocks(slot, SAMPLE_TRIP.context, {
    weather: contextLabels.weather,
    packing: contextLabels.packing,
    goingFor: contextLabels.goingFor,
    dayOne: contextLabels.dayOne,
    today: contextLabels.today,
    yourHighlights: contextLabels.yourHighlights,
  });

const REMINDER_SLOTS = [
  "pack_early_14d",
  "visa_check_7d",
  "weather_3d",
  "confirm_1d",
  "morning_of",
];
const FOLLOWUP_SLOTS = [
  "followup_return_3d",
  "followup_next_21d",
  "followup_final_45d",
  "followup_dormant",
];

const reminderJobs: Job[] = REMINDER_SLOTS.map((slot) => {
  const props = {
    slot,
    destination: DEST,
    tripDates: SAMPLE_TRIP.dates,
    heading: fill(reminderCopy[slot].heading),
    body: fill(reminderCopy[slot].body),
    // Shared across all five slots — see the reminder namespace root.
    ctaLabel: reminderCopy.cta,
    tripUrl: `${APP}/trips/SAMPLE`,
    locale: L,
    contextBlocks: ctxFor(slot),
  };
  return {
    label: `trip_reminder:${slot}`,
    // The SHARED builder, not a copy. This drifted once already: the guard
    // was added to send.ts and not here, so a review set went out reading
    // "Three days to Paris — Paris" — a subject the product cannot produce.
    // A review of copy that does not ship is worse than no review.
    subject: `[TEST ${L}] ${tripReminderSubject({ heading: props.heading, destination: DEST })}`,
    element: TripReminderEmail(props),
    text: tripReminderEmailText(props),
  };
});

const followupJobs: Job[] = FOLLOWUP_SLOTS.map((slot) => {
  const isTerminal = TERMINAL_FOLLOWUP_SLOTS.has(slot);
  const props = {
    slot,
    destination: DEST,
    heading: fill(followupCopy[slot].heading),
    body: fill(followupCopy[slot].body),
    // Per-slot here, unlike the reminders.
    ctaLabel: followupCopy[slot].cta,
    // Matches the cron: only the +3d mail returns to the finished trip.
    ctaUrl:
      slot === "followup_return_3d"
        ? `${APP}/trips/SAMPLE`
        : `${APP}/trips/new?slot=${slot}`,
    finalNote: isTerminal ? followupCopy.finalNote : undefined,
    locale: L,
    contextBlocks: ctxFor(slot),
  };
  return {
    label: `trip_followup:${slot}`,
    // No "— destination" suffix, mirroring tripFollowupSubject.
    subject: `[TEST ${L}] ${props.heading}`,
    element: TripFollowupEmail(props),
    text: tripFollowupEmailText(props),
  };
});

const jobs: Job[] = [
  ...reminderJobs,
  ...followupJobs,
  {
    label: "confirm_signup",
    subject: `[TEST ${L}] Confirm signup`,
    element: ConfirmSignupEmail({
      name: "Federico",
      confirmUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=signup`,
      locale: L,
    }),
    text: confirmSignupEmailText({
      name: "Federico",
      confirmUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=signup`,
      locale: L,
    }),
  },
  {
    label: "invite",
    subject: "[TEST] Maria invited you to plan Lisbon — MonkeyTravel",
    element: InviteEmail({
      inviterName: "Maria",
      tripTitle: "Lisbon Long Weekend",
      tripDestination: "Lisbon",
      tripDates: "Sep 12 – Sep 15, 2026",
      role: "editor",
      inviteUrl: `${APP}/invite/SAMPLE-TOKEN`,
      message: "Booked the flights! Can you add the food spots you found?",
      locale: L,
    }),
    text: inviteEmailText({
      inviterName: "Maria",
      tripTitle: "Lisbon Long Weekend",
      tripDestination: "Lisbon",
      tripDates: "Sep 12 – Sep 15, 2026",
      role: "editor",
      inviteUrl: `${APP}/invite/SAMPLE-TOKEN`,
      message: "Booked the flights! Can you add the food spots you found?",
    }),
  },
  {
    label: "vote_cast",
    subject: "[TEST] New feedback on your Lisbon trip — MonkeyTravel",
    element: VoteCastEmail({
      voterName: "Maria",
      tripTitle: "Lisbon Long Weekend",
      tripDestination: "Lisbon",
      voteType: "love",
      activityLabel: "Sunset at Miradouro da Senhora do Monte",
      tripUrl: `${APP}/trips/SAMPLE`,
      locale: L,
    }),
    text: voteCastEmailText({
      voterName: "Maria",
      tripTitle: "Lisbon Long Weekend",
      tripDestination: "Lisbon",
      voteType: "love",
      activityLabel: "Sunset at Miradouro da Senhora do Monte",
      tripUrl: `${APP}/trips/SAMPLE`,
    }),
  },
  {
    label: "auth_recovery",
    subject: `[TEST ${L}] ` + authActionSubject("recovery", L),
    element: AuthActionEmail({
      kind: "recovery",
      actionUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=recovery`,
      locale: L,
    }),
    text: authActionEmailText({
      kind: "recovery",
      actionUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=recovery`,
      locale: L,
    }),
  },
  {
    label: "auth_magiclink",
    subject: `[TEST ${L}] ` + authActionSubject("magiclink", L),
    element: AuthActionEmail({
      kind: "magiclink",
      actionUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=magiclink`,
      locale: L,
    }),
    text: authActionEmailText({
      kind: "magiclink",
      actionUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=magiclink`,
      locale: L,
    }),
  },
  {
    label: "auth_email_change",
    subject: `[TEST ${L}] ` + authActionSubject("email_change", L),
    element: AuthActionEmail({
      kind: "email_change",
      actionUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=email_change`,
      locale: L,
    }),
    text: authActionEmailText({
      kind: "email_change",
      actionUrl: `${APP}/auth/callback?token_hash=SAMPLE&type=email_change`,
      locale: L,
    }),
  },
  {
    label: "blog_digest",
    subject: `[TEST ${L}] ` + blogDigestSubject(L),
    element: BlogDigestEmail({ locale: L, posts: blogCards, blogUrl: `${APP}/blog` }),
    text: blogDigestEmailText({ locale: L, posts: blogCards, blogUrl: `${APP}/blog` }),
  },
  {
    label: "blog_announce",
    subject: `[TEST ${L}] ` + blogAnnounceSubject(featured?.title ?? "New post", L),
    element: BlogAnnounceEmail({ locale: L, post: featured, blogUrl: `${APP}/blog` }),
    text: blogAnnounceEmailText({ locale: L, post: featured, blogUrl: `${APP}/blog` }),
  },
];

// Optional comma-separated label filter, e.g. ONLY=auth_magiclink,invite
const only = (process.env.ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resend silently drops mail to a suppressed address and still returns a
 * message id, so a green tick here proves nothing about delivery. Check
 * up front and say so — this is exactly how the old default recipient
 * (federicosciuca@droplab.com, hard-bounced 2026-05-30) went on
 * "succeeding" for months.
 *
 * Best-effort: an API shape change must not block a design review, so a
 * failed lookup warns and continues rather than exiting.
 */
async function warnAboutSuppressed(recipients: string[]): Promise<void> {
  try {
    const res = await fetch("https://api.resend.com/suppressions?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`! suppression pre-check unavailable (HTTP ${res.status})\n`);
      return;
    }
    const body = (await res.json()) as { data?: Array<{ email?: string }> };
    const suppressed = new Set(
      (body.data ?? [])
        .map((s) => (s.email ?? "").toLowerCase())
        .filter(Boolean)
    );
    const hits = recipients.filter((r) => suppressed.has(r.toLowerCase()));
    if (hits.length) {
      console.warn(
        `! SUPPRESSED, will NOT arrive: ${hits.join(", ")}\n` +
          `  Remove them in Resend, or pass TEST_TO with a deliverable address.\n`
      );
    }
  } catch (err) {
    console.warn(
      `! suppression pre-check failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
  }
}

async function main() {
  // Prefix match, so ONLY=trip_followup selects all four followup slots
  // and ONLY=trip_followup:followup_final_45d selects exactly one.
  const selected = only.length
    ? jobs.filter((j) => only.some((o) => j.label === o || j.label.startsWith(`${o}:`)))
    : jobs;

  if (!selected.length) {
    console.error(`No jobs matched ONLY=${only.join(",")}`);
    process.exit(1);
  }

  // DRY_RUN renders every template and reports on it without sending.
  // These go to real colleagues; rendering first means a broken template
  // is caught here rather than in three inboxes.
  if (process.env.DRY_RUN) {
    console.log(
      `DRY RUN — rendering ${selected.length} templates, sending none\n` +
        `Sample trip: ${SAMPLE_TRIP.destination} — ` +
        `${SAMPLE_TRIP.context.day1.activities.map((a) => a.name).join(", ")}\n` +
        `(subjects below must name the same city as that agenda)\n`
    );
    let bad = 0;
    for (const job of selected) {
      const html = await render(job.element);
      // An unresolved next-intl key or an un-substituted placeholder is
      // the exact defect that reached real inboxes for two months.
      const leaks = ["{destination}", "tripReminderEmail.", "tripFollowupEmail."]
        .filter((needle) => html.includes(needle) || job.subject.includes(needle));
      const ok = html.length > 500 && leaks.length === 0;
      if (!ok) bad++;
      console.log(
        `${ok ? "✓" : "✗"} ${job.label.padEnd(34)} ${String(html.length).padStart(6)}b  ${job.subject}` +
          (leaks.length ? `\n    LEAKED: ${leaks.join(", ")}` : "")
      );
    }
    if (bad) {
      console.error(`\n${bad} of ${selected.length} failed to render cleanly`);
      process.exit(1);
    }
    console.log(`\nAll ${selected.length} rendered clean.`);
    return;
  }

  await warnAboutSuppressed(to);

  console.log(
    `Sending ${selected.length} test emails to ${to.join(", ")} from ${FROM}\n`
  );
  let failures = 0;
  for (const job of selected) {
    const html = await render(job.element);
    const result = await resend.emails.send({
      from: FROM,
      to,
      replyTo: REPLY_TO,
      subject: job.subject,
      html,
      text: job.text,
      // Resend tag values accept only ASCII letters, digits, underscore
      // and dash — the "family:slot" labels carry a colon, which the API
      // rejects outright, failing the whole send.
      tags: [{ name: "template", value: job.label.replace(/[^A-Za-z0-9_-]/g, "_") }],
    });
    if (result.error) {
      failures++;
      console.error(`✗ ${job.label}: ${result.error.message}`);
    } else {
      console.log(`✓ ${job.label}: ${result.data?.id}`);
    }
    // Stay under Resend's 5 req/s free-tier limit.
    await sleep(300);
  }

  if (failures) {
    console.error(`\n${failures} of ${selected.length} failed`);
    process.exit(1);
  }
  console.log(`\nAll ${selected.length} sent.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
