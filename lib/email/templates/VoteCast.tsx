/**
 * Vote-cast notification email.
 *
 * Sent to the trip owner when a collaborator votes on an activity.
 * Transactional category (collaboration is the explicit reason this
 * person signed up), but still opt-out-able via
 * users.notification_settings.emailNotifications + collabVotes.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";

export interface VoteCastEmailProps {
  voterName: string;
  tripTitle: string;
  tripDestination: string;
  voteType: "love" | "flexible" | "concerns" | "no";
  activityLabel: string;
  /** Pre-built absolute URL to the trip edit page. */
  tripUrl: string;
}

const VOTE_PHRASE: Record<VoteCastEmailProps["voteType"], string> = {
  love: "loved",
  flexible: "is flexible on",
  concerns: "raised concerns about",
  no: "voted no on",
};

const VOTE_EMOJI: Record<VoteCastEmailProps["voteType"], string> = {
  love: "❤️",
  flexible: "🤷",
  concerns: "⚠️",
  no: "👎",
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function VoteCastEmail({
  voterName,
  tripTitle,
  tripDestination,
  voteType,
  activityLabel,
  tripUrl,
}: VoteCastEmailProps) {
  const preview = `${voterName} ${VOTE_PHRASE[voteType]} ${activityLabel}`;

  return (
    <EmailLayout
      preview={preview}
      unsubscribeUrl={`${APP_URL}/profile/notifications`}
    >
      <Heading as="h1" style={h1}>
        {VOTE_EMOJI[voteType]} New activity feedback
      </Heading>

      <Text style={leadText}>
        {voterName} {VOTE_PHRASE[voteType]} an activity in your trip.
      </Text>

      <Section style={tripBox}>
        <Text style={tripLabel}>
          {tripTitle ? `"${tripTitle}"` : tripDestination}
        </Text>
        <Text style={activityText}>{activityLabel}</Text>
      </Section>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={tripUrl} style={button}>
          See the trip
        </Button>
      </Section>

      <Text style={smallText}>
        Don't want these? You can turn them off in{" "}
        <a href={`${APP_URL}/profile/notifications`} style={linkText}>
          notification settings
        </a>
        .
      </Text>
    </EmailLayout>
  );
}

/** Plain-text fallback. Hand-written. */
export function voteCastEmailText(props: VoteCastEmailProps): string {
  return [
    `${props.voterName} ${VOTE_PHRASE[props.voteType]} an activity in your trip.`,
    "",
    `Trip: ${props.tripTitle || props.tripDestination}`,
    `Activity: ${props.activityLabel}`,
    "",
    `See the trip: ${props.tripUrl}`,
    "",
    "—",
    `Turn off: ${APP_URL}/profile/notifications`,
  ].join("\n");
}

const h1: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  color: "#1A1A1A",
  margin: "0 0 16px",
};

const leadText: React.CSSProperties = {
  fontSize: "16px",
  color: "#333333",
  margin: "0 0 20px",
  lineHeight: 1.6,
};

const tripBox: React.CSSProperties = {
  backgroundColor: "#FFFAF5",
  borderRadius: "8px",
  padding: "16px",
  margin: "16px 0 24px",
};

const tripLabel: React.CSSProperties = {
  fontSize: "13px",
  color: "#888888",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  margin: "0 0 4px",
};

const activityText: React.CSSProperties = {
  fontSize: "17px",
  fontWeight: 600,
  color: "#1A1A1A",
  margin: 0,
  lineHeight: 1.4,
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

const smallText: React.CSSProperties = {
  fontSize: "12px",
  color: "#888888",
  margin: "24px 0 0",
  lineHeight: 1.5,
};

const linkText: React.CSSProperties = {
  color: "#FF6B6B",
  textDecoration: "underline",
};
