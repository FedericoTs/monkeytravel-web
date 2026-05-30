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

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={tripUrl} style={button}>
          {ctaLabel}
        </Button>
      </Section>
    </EmailLayout>
  );
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
    "",
    `${props.ctaLabel}: ${props.tripUrl}`,
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
