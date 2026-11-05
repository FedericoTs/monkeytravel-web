/**
 * In-trip evening-before digest email — Live Trip plan, Phase 4.1.
 *
 * Sent by the daily cron (app/api/cron/scheduled-notifications) for each
 * `in_trip_day_<K>` slot: "Tomorrow: Day 3 — Alfama", with the day's plan and
 * a link that opens it. Transactional — the owner is on the trip — so it is
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
import { tripReminderSubject } from "./TripReminder";
import { ContextBlocks, contextBlocksText } from "./_context-blocks";
import type { ContextBlock } from "../trip-context";
import type { EmailLocale } from "../copy";
import { h1, leadText, bodyText, button, secondaryButton } from "./_styles";

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
  /** The button's target: the owner's signed day page, or a participant's share link. */
  tripUrl: string;
  /** Optional pre-built HMAC unsubscribe URL: an account's (key='tripReminders') or a guest's. */
  unsubscribeUrl?: string;
  /** Recipient UI language — localizes the shared shell. */
  locale?: EmailLocale;
  /** The footer's words for a guest, who has no account. */
  footerCopy?: { reason: string; link: string };
  /**
   * The owner's "send tomorrow's plan to the group" box, below the main
   * button. Pre-translated; the cron decides when it applies.
   */
  groupSend?: { text: string; label: string; url: string };
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
  groupSend,
  footerCopy,
}: TripDayDigestEmailProps) {
  const preview = `📅 ${tripReminderSubject({ heading, destination })}`;
  const hasPlan = (blocks?.length ?? 0) > 0;

  return (
    <EmailLayout
      preview={preview}
      unsubscribeUrl={unsubscribeUrl ?? `${APP_URL}/profile/notifications`}
      locale={locale}
      footerCopy={footerCopy}
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

      {groupSend ? (
        <Section style={groupSendBox}>
          <Text style={groupSendText}>{groupSend.text}</Text>
          <Button href={groupSend.url} style={secondaryButton}>
            {groupSend.label}
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}

/**
 * Subject for a day digest: tripReminderSubject's rule, which appends the
 * destination unless the heading already names it.
 */
export const tripDayDigestSubject = tripReminderSubject;

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
    ...(props.groupSend ? ["", props.groupSend.text, `${props.groupSend.label}: ${props.groupSend.url}`] : []),
    "",
    "—",
    "MonkeyTravel · AI-powered trip planning",
    ...(props.footerCopy ? [props.footerCopy.reason] : []),
    `${props.footerCopy?.link ?? "Manage preferences"}: ${props.unsubscribeUrl ?? `${APP_URL}/profile/notifications`}`,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

// This email's own inline styles; the shared ones are in ./_styles.

const moreText: React.CSSProperties = {
  fontSize: "14px",
  color: "#888888",
  margin: "4px 0 0",
};

// The group box matches TripReminder's group ask.
const groupSendBox: React.CSSProperties = {
  backgroundColor: "#FFF5EB",
  borderRadius: "12px",
  padding: "16px 20px",
  margin: "0 0 8px",
  textAlign: "center",
};

const groupSendText: React.CSSProperties = {
  fontSize: "15px",
  color: "#333333",
  lineHeight: 1.5,
  margin: "0 0 12px",
};

