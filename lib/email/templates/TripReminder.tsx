/**
 * Pre-trip reminder cascade email.
 *
 * Sent from the daily cron (app/api/cron/scheduled-notifications) at
 * each of the five slots: T-14d (pack early), T-7d (visa check), T-3d
 * (weather), T-1d (confirm bookings), and morning-of.
 *
 * Localised via next-intl: the cron route resolves the recipient's
 * preferred_language, calls getTranslations({ locale, namespace:
 * 'tripReminderEmail' }), and passes the pre-rendered strings into this
 * template. The template itself is intentionally string-prop-only — no
 * i18n inside the JSX — so it stays trivially testable and snapshot-
 * stable.
 *
 * Gated by users.notification_settings.tripReminders (fail-closed via
 * lib/email/send.ts; see NOTIFICATION_SETTING_KEY['trip_reminder']).
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { ContextBlocks, contextBlocksText } from "./_context-blocks";
import type { ContextBlock } from "../trip-context";
import type { EmailLocale } from "../copy";

/**
 * Slot discriminator. Matches the CHECK constraint in
 * supabase/migrations/20260601_scheduled_notifications.sql.
 */
export type TripReminderSlot =
  | "pack_early_14d"
  | "visa_check_7d"
  | "weather_3d"
  | "confirm_1d"
  | "morning_of";

export interface TripReminderEmailProps {
  /** Slot — drives only the emoji + the layout's preview prefix. */
  slot: TripReminderSlot;
  /** Trip's destination (e.g. "Lisbon"). Falls back to the trip title. */
  destination: string;
  /** Pre-formatted date range (e.g. "Sep 1 – Sep 7"). Locale-specific. */
  tripDates?: string;
  /** Pre-translated short heading. Slot-specific. */
  heading: string;
  /** Pre-translated lead paragraph. Slot-specific. */
  body: string;
  /** Pre-translated CTA label. */
  ctaLabel: string;
  /** Pre-built absolute URL to the trip page (or focus deep-link). */
  tripUrl: string;
  /** Optional pre-built HMAC unsubscribe URL (key='tripReminders'). */
  unsubscribeUrl?: string;
  /** Recipient UI language — localizes the shared shell. */
  locale?: EmailLocale;
  /**
   * Per-trip enrichment (weather note, packing, day-one plan), built by
   * lib/email/trip-context.ts from data the generator already stored.
   * Optional and frequently absent — a third of trips have no highlights —
   * so the email must read as finished with none of it.
   */
  contextBlocks?: ContextBlock[];
  /**
   * A second, smaller ask under the main button: on a group trip nobody else
   * has the plan yet, so the organiser is asked to add the people coming.
   * Pre-translated; the cron decides when it applies.
   */
  groupAsk?: { text: string; label: string; url: string };
}

/** Slot → emoji. Visual hook, not load-bearing for the message. */
const SLOT_EMOJI: Record<TripReminderSlot, string> = {
  pack_early_14d: "🎒",
  visa_check_7d: "🛂",
  weather_3d: "☀️",
  confirm_1d: "✅",
  morning_of: "✈️",
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function TripReminderEmail({
  slot,
  destination,
  tripDates,
  heading,
  body,
  ctaLabel,
  tripUrl,
  unsubscribeUrl,
  locale = "en",
  contextBlocks,
  groupAsk,
}: TripReminderEmailProps) {
  const preview = `${SLOT_EMOJI[slot]} ${heading} — ${destination}`;

  return (
    <EmailLayout
      preview={preview}
      unsubscribeUrl={unsubscribeUrl ?? `${APP_URL}/profile/notifications`}
      locale={locale}
    >
      <Heading as="h1" style={h1}>
        {SLOT_EMOJI[slot]} {heading}
      </Heading>

      <Text style={leadText}>
        {destination}
        {tripDates ? ` — ${tripDates}` : ""}
      </Text>

      <Text style={bodyText}>{body}</Text>

      <ContextBlocks blocks={contextBlocks} />

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={tripUrl} style={button}>
          {ctaLabel}
        </Button>
      </Section>

      {groupAsk ? (
        <Section style={groupAskBox}>
          <Text style={groupAskText}>{groupAsk.text}</Text>
          <Button href={groupAsk.url} style={secondaryButton}>
            {groupAsk.label}
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}

/**
 * The subject line for a pre-trip reminder.
 *
 * Appends the destination to the heading — EXCEPT when the heading already
 * carries it. weather_3d's heading is "Three days to {destination}" in all
 * four locales, so appending unconditionally printed the destination twice:
 *
 *   "Three days to Palermo, Agrigento, Syracuse & Taormina
 *    — Palermo, Agrigento, Syracuse & Taormina"          (95 chars)
 *
 * On the live queue that put 27 of 699 subjects past the ~78 characters a
 * mail client will show, and the worst were all multi-city trips.
 *
 * EXPORTED because three call sites need this identical rule: the send path,
 * scripts/audit-queued-emails.mts, and scripts/send-test-emails.mts. It was
 * duplicated once and drifted within the hour — the fix shipped in send.ts
 * while the review script kept mailing "Three days to Paris — Paris". One
 * definition is the only version of this that stays true.
 */
export function tripReminderSubject(props: {
  heading: string;
  destination: string;
}): string {
  return props.heading.includes(props.destination)
    ? props.heading
    : `${props.heading} — ${props.destination}`;
}

/**
 * Plain-text fallback. Hand-built rather than auto-derived because the
 * stripped HTML loses too much structure. Sent to spam-filter-
 * conservative clients (Outlook 2007, corporate gateways).
 */
export function tripReminderEmailText(props: TripReminderEmailProps): string {
  const lines = [
    `${SLOT_EMOJI[props.slot]} ${props.heading}`,
    "",
    `${props.destination}${props.tripDates ? ` — ${props.tripDates}` : ""}`,
    "",
    props.body,
    ...contextBlocksText(props.contextBlocks),
    "",
    `${props.ctaLabel}: ${props.tripUrl}`,
    ...(props.groupAsk ? ["", props.groupAsk.text, `${props.groupAsk.label}: ${props.groupAsk.url}`] : []),
    "",
    "—",
    "MonkeyTravel · AI-powered trip planning",
    `Manage preferences: ${props.unsubscribeUrl ?? `${APP_URL}/profile/notifications`}`,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

// Inline styles — mirror the Invite + VoteCast templates so all 3
// transactional emails render the same brand language.

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

// The group ask sits under the main button, quieter than it: dark text on
// white, so it reads as the second thing to do.
const groupAskBox: React.CSSProperties = {
  backgroundColor: "#FFF5EB",
  borderRadius: "12px",
  padding: "16px 20px",
  margin: "0 0 8px",
  textAlign: "center",
};

const groupAskText: React.CSSProperties = {
  fontSize: "15px",
  color: "#333333",
  lineHeight: 1.5,
  margin: "0 0 12px",
};

const secondaryButton: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  color: "#2D3436",
  border: "1px solid #D9CFC4",
  padding: "10px 24px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "15px",
  display: "inline-block",
};
