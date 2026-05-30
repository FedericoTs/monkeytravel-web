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

import * as InviteMod from "../lib/email/templates/Invite";
import * as VoteCastMod from "../lib/email/templates/VoteCast";
import * as TripReminderMod from "../lib/email/templates/TripReminder";
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
const to = process.env.TEST_TO || "federicosciuca@droplab.com";
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

const jobs: Job[] = [
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
    label: "trip_reminder",
    subject: "[TEST] Time to pack for Lisbon — MonkeyTravel",
    element: TripReminderEmail({
      slot: "pack_early_14d",
      destination: "Lisbon",
      tripDates: "Sep 12 – Sep 15",
      heading: "Two weeks to go!",
      body: "Your Lisbon trip is coming up. Now's a great time to start a packing list and double-check your documents.",
      ctaLabel: "Open my trip",
      tripUrl: `${APP}/trips/SAMPLE`,
      locale: L,
    }),
    text: tripReminderEmailText({
      slot: "pack_early_14d",
      destination: "Lisbon",
      tripDates: "Sep 12 – Sep 15",
      heading: "Two weeks to go!",
      body: "Your Lisbon trip is coming up. Now's a great time to start a packing list and double-check your documents.",
      ctaLabel: "Open my trip",
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

async function main() {
  const selected = only.length
    ? jobs.filter((j) => only.includes(j.label))
    : jobs;
  console.log(`Sending ${selected.length} test emails to ${to} from ${FROM}\n`);
  for (const job of selected) {
    const html = await render(job.element);
    const result = await resend.emails.send({
      from: FROM,
      to,
      replyTo: REPLY_TO,
      subject: job.subject,
      html,
      text: job.text,
      tags: [{ name: "template", value: job.label }],
    });
    if (result.error) {
      console.error(`✗ ${job.label}: ${result.error.message}`);
    } else {
      console.log(`✓ ${job.label}: ${result.data?.id}`);
    }
    // Stay under Resend's 5 req/s free-tier limit.
    await sleep(300);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
