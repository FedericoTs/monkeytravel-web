/**
 * In-trip evening-before digest email — Live Trip plan, Phase 4.1.
 *
 * Sent by the daily cron (app/api/cron/scheduled-notifications) for each
 * `in_trip_day_<K>` slot: "Tomorrow: Day 3 — Alfama", with the day's plan and
 * a deep link to Today. Transactional — the owner is on the trip — so it is
 * gated on tripReminders (lib/email/send.ts NOTIFICATION_SETTING_KEY).
 *
 * String-prop-only, like the sibling lifecycle templates: the cron resolves
 * the recipient's language and passes pre-translated strings, so the JSX has
 * no i18n and stays snapshot-stable. The day's plan reuses the shared
 * ContextBlocks renderer (one block: the day's activities as time + name), so
 * the containment gate in verify-render.ts covers it exactly as it covers the
 * pre-trip enrichment.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { ContextBlocks, contextBlocksText } from "./_context-blocks";
import type { ContextBlock } from "../trip-context";
import type { EmailLocale } from "../copy";

export interface TripDayDigestEmailProps {
  /** The trip day this digest is about (2..N). Drives only the copy. */
  day: number;
  /** Trip's destination (e.g. "Lisbon"). Falls back to the trip title. */
  destination: string;
  /** Pre-translated heading, e.g. "Tomorrow: Day 3". */
  heading: string;
  /** Pre-translated lead paragraph. */
  intro: string;
  /**
   * Tomorrow's plan as a single context block (label = the day's title, items
   * = its activities, meta = start time). Absent/empty when the day has no
   * activities yet — then `emptyLine` shows instead.
   */
  blocks?: ContextBlock[];
  /** Pre-translated line shown when tomorrow has no activities planned. */
  emptyLine?: string;
  /**
   * Pre-translated "+N more" line when the day has more activities than shown.
   * Rendered OUTSIDE the context block on purpose: the containment gate checks
   * every block line against the trip's own data, and this is UI copy, not
   * trip data — putting it in the block would (correctly) fail that check.
   */
  andMore?: string;
  /** Pre-translated CTA label. */
  ctaLabel: string;
  /** Absolute URL to the trip (opens Today while the trip is live). */
  tripUrl: string;
  /** Optional pre-built HMAC unsubscribe URL (key='tripReminders'). */
  unsubscribeUrl?: string;
  /** Recipient UI language — localizes the shared shell. */
  locale?: EmailLocale;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function TripDayDigestEmail({
  destination,
  heading,
  intro,
  blocks,
  emptyLine,
  andMore,
  ctaLabel,
  tripUrl,
  unsubscribeUrl,
  locale = "en",
}: TripDayDigestEmailProps) {
  const preview = `📅 ${heading} — ${destination}`;
  const hasPlan = (blocks?.length ?? 0) > 0;

  return (
    <EmailLayout
      preview={preview}
      unsubscribeUrl={unsubscribeUrl ?? `${APP_URL}/profile/notifications`}
      locale={locale}
    >
      <Heading as="h1" style={h1}>
        📅 {heading}
      </Heading>

      <Text style={leadText}>{destination}</Text>

      <Text style={bodyText}>{intro}</Text>

      {hasPlan ? (
        <ContextBlocks blocks={blocks} />
      ) : emptyLine ? (
        <Text style={bodyText}>{emptyLine}</Text>
      ) : null}

      {hasPlan && andMore ? <Text style={moreText}>{andMore}</Text> : null}

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={tripUrl} style={button}>
          {ctaLabel}
        </Button>
      </Section>
    </EmailLayout>
  );
}

/**
 * Subject for a day digest. Appends the destination unless the heading already
 * carries it — the same rule and reason as tripReminderSubject (a heading that
 * already names the place would otherwise print it twice).
 */
export function tripDayDigestSubject(props: { heading: string; destination: string }): string {
  return props.heading.includes(props.destination)
    ? props.heading
    : `${props.heading} — ${props.destination}`;
}

/** Plain-text fallback, mirroring tripReminderEmailText. */
export function tripDayDigestEmailText(props: TripDayDigestEmailProps): string {
  const hasPlan = (props.blocks?.length ?? 0) > 0;
  const lines = [
    `📅 ${props.heading}`,
    "",
    props.destination,
    "",
    props.intro,
    ...(hasPlan ? contextBlocksText(props.blocks) : props.emptyLine ? ["", props.emptyLine] : []),
    ...(hasPlan && props.andMore ? [props.andMore] : []),
    "",
    `${props.ctaLabel}: ${props.tripUrl}`,
    "",
    "—",
    "MonkeyTravel · AI-powered trip planning",
    `Manage preferences: ${props.unsubscribeUrl ?? `${APP_URL}/profile/notifications`}`,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

// Inline styles — identical to TripReminder so the three transactional
// emails render the same brand language.

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

const moreText: React.CSSProperties = {
  fontSize: "14px",
  color: "#888888",
  margin: "4px 0 0",
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
