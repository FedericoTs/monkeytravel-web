/**
 * Post-trip re-engagement email (Loop 2).
 *
 * Sent from the daily cron (app/api/cron/scheduled-notifications) at
 * end_date +3d / +21d / +45d, plus a one-time `followup_dormant` slot for
 * users who had already gone quiet before this existed.
 *
 * HOW THIS DIFFERS FROM TripReminder
 * ----------------------------------
 * 1. Consent. Pre-trip reminders are transactional — the recipient made
 *    the trip and asked to be reminded. These are marketing: nobody
 *    triggered them. Gated on marketingNotifications via
 *    NOTIFICATION_SETTING_KEY['trip_followup'] in lib/email/send.ts.
 * 2. No emoji. The reminder family leads each heading with one (🎒 🛂 ☀️).
 *    That register is wrong here: "Last one from us" with a cheerful
 *    glyph reads as tone-deaf, and mixing emoji/no-emoji inside one
 *    sequence looks like a bug. The whole family goes without.
 * 3. A visible end. The final slot states plainly that it is the last
 *    email in the sequence. Saying so is what makes the promise real,
 *    and it measurably beats a silent stop for complaint rate.
 *
 * String-prop-only, like TripReminder: the cron resolves every piece of
 * copy in the recipient's locale and passes it in, so this file stays
 * trivially snapshot-testable and carries no i18n of its own.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { ContextBlocks, contextBlocksText } from "./_context-blocks";
import type { ContextBlock } from "../trip-context";
import type { EmailLocale } from "../copy";

/**
 * Slot discriminator. Matches the CHECK constraint in
 * supabase/migrations/20260827130000_post_trip_followups.sql.
 */
export type TripFollowupSlot =
  | "followup_return_3d"
  | "followup_next_21d"
  | "followup_final_45d"
  | "followup_dormant";

/** Slots that terminate the sequence — these carry the closing note. */
export const TERMINAL_FOLLOWUP_SLOTS: ReadonlySet<TripFollowupSlot> = new Set([
  "followup_final_45d",
  "followup_dormant",
]);

export interface TripFollowupEmailProps {
  slot: TripFollowupSlot;
  /** Trip's destination (e.g. "Lisbon"). Falls back to the trip title. */
  destination: string;
  /** Pre-translated short heading. Slot-specific. */
  heading: string;
  /** Pre-translated lead paragraph. Slot-specific. */
  body: string;
  /** Pre-translated CTA label. Slot-specific. */
  ctaLabel: string;
  /** Where the CTA goes — the saved trip, or the wizard. Cron decides. */
  ctaUrl: string;
  /**
   * Pre-translated "this is the last email in this sequence" line. Only
   * supplied for terminal slots; omitted elsewhere.
   */
  finalNote?: string;
  /** Optional pre-built HMAC unsubscribe URL (key='marketingNotifications'). */
  unsubscribeUrl?: string;
  /** Recipient UI language — localizes the shared shell. */
  locale?: EmailLocale;
  /**
   * Per-trip enrichment. Only followup_return_3d populates this (with the
   * trip's highlights) — the later slots stay bare on purpose, because a
   * recap of a trip six weeks gone works against "we won't keep nudging".
   */
  contextBlocks?: ContextBlock[];
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function TripFollowupEmail({
  slot,
  destination,
  heading,
  body,
  ctaLabel,
  ctaUrl,
  finalNote,
  unsubscribeUrl,
  locale = "en",
  contextBlocks,
}: TripFollowupEmailProps) {
  const isTerminal = TERMINAL_FOLLOWUP_SLOTS.has(slot);

  return (
    <EmailLayout
      preview={`${heading} — ${destination}`}
      unsubscribeUrl={unsubscribeUrl ?? `${APP_URL}/profile/notifications`}
      locale={locale}
    >
      <Heading as="h1" style={h1}>
        {heading}
      </Heading>

      <Text style={leadText}>{destination}</Text>

      <Text style={bodyText}>{body}</Text>

      <ContextBlocks blocks={contextBlocks} />

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={ctaUrl} style={button}>
          {ctaLabel}
        </Button>
      </Section>

      {isTerminal && finalNote ? (
        <Text style={finalNoteText}>{finalNote}</Text>
      ) : null}
    </EmailLayout>
  );
}

/**
 * Plain-text fallback. Hand-built rather than derived from the HTML,
 * matching tripReminderEmailText — stripped markup loses the structure
 * that makes the short version readable.
 */
export function tripFollowupEmailText(props: TripFollowupEmailProps): string {
  const lines = [
    props.heading,
    "",
    props.destination,
    "",
    props.body,
    ...contextBlocksText(props.contextBlocks),
    "",
    `${props.ctaLabel}: ${props.ctaUrl}`,
  ];

  if (TERMINAL_FOLLOWUP_SLOTS.has(props.slot) && props.finalNote) {
    lines.push("", props.finalNote);
  }

  lines.push(
    "",
    "—",
    "MonkeyTravel · AI-powered trip planning",
    `Manage preferences: ${
      props.unsubscribeUrl ?? `${APP_URL}/profile/notifications`
    }`
  );

  return lines.join("\n");
}

/**
 * Subject line. The heading already reads as a subject in every locale
 * ("How was Lisbon?", "Thinking about the next one?"), so we mirror it —
 * same approach as trip_reminder, which keeps subject and first line in
 * sync so the inbox preview never contradicts the open.
 *
 * Unlike trip_reminder we do NOT append "— {destination}": these
 * headings either already name the destination or deliberately don't,
 * and bolting it on turns "Last one from us" into something that reads
 * like an automated report.
 */
export function tripFollowupSubject(props: {
  heading: string;
  destination: string;
  slot: TripFollowupSlot;
}): string {
  return props.heading;
}

// Inline styles — deliberately identical to TripReminder's so the two
// halves of the trip lifecycle read as one brand, not two products.

const h1: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  color: "#1A1A1A",
  margin: "0 0 16px",
  lineHeight: 1.3,
};

const leadText: React.CSSProperties = {
  fontSize: "18px",
  color: "#555555",
  margin: "0 0 24px",
  fontWeight: 600,
};

const bodyText: React.CSSProperties = {
  fontSize: "16px",
  color: "#333333",
  lineHeight: 1.6,
  margin: "16px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#FF6B6B",
  color: "#FFFFFF",
  padding: "12px 32px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "16px",
  display: "inline-block",
};

const finalNoteText: React.CSSProperties = {
  fontSize: "14px",
  color: "#777777",
  lineHeight: 1.5,
  margin: "24px 0 0",
  fontStyle: "italic",
};
