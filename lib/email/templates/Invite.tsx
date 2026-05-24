/**
 * Invite-to-trip email.
 *
 * Sent when a user invites a collaborator by email address via the
 * ShareAndInviteModal → POST /api/trips/[id]/invites with `recipient_email`.
 *
 * Always transactional (user explicitly initiated). No opt-out check —
 * receiving an invite is by definition triggered by the recipient being
 * named.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";

export interface InviteEmailProps {
  inviterName: string;
  tripTitle: string;
  tripDestination: string;
  tripDates?: string; // pre-formatted "Sep 1 – Sep 7, 2026"
  role: "editor" | "voter" | "viewer";
  /** Pre-built absolute URL to /invite/[token]. */
  inviteUrl: string;
  /** Optional personal note from the inviter (max ~500 chars). */
  message?: string;
}

const ROLE_DESCRIPTION: Record<InviteEmailProps["role"], string> = {
  editor: "You'll be able to add, remove, and rearrange activities.",
  voter:
    "You'll be able to vote on activities and suggest new ones — the trip owner has final say.",
  viewer: "You'll be able to see the trip details, but can't make changes.",
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function InviteEmail({
  inviterName,
  tripTitle,
  tripDestination,
  tripDates,
  role,
  inviteUrl,
  message,
}: InviteEmailProps) {
  const preview = `${inviterName} invited you to plan ${tripDestination}`;

  return (
    <EmailLayout
      preview={preview}
      unsubscribeUrl={`${APP_URL}/profile/notifications`}
    >
      <Heading as="h1" style={h1}>
        {inviterName} invited you to a trip
      </Heading>

      <Text style={leadText}>
        {tripTitle ? `"${tripTitle}"` : tripDestination}
        {tripDates ? ` — ${tripDates}` : ""}
      </Text>

      {message && (
        <Section style={messageBox}>
          <Text style={messageText}>“{message}”</Text>
          <Text style={messageAttribution}>— {inviterName}</Text>
        </Section>
      )}

      <Text style={bodyText}>{ROLE_DESCRIPTION[role]}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={inviteUrl} style={button}>
          Open the trip
        </Button>
      </Section>

      <Text style={smallText}>
        Or copy this link:{" "}
        <span style={linkText}>{inviteUrl}</span>
      </Text>
    </EmailLayout>
  );
}

/**
 * Plain-text fallback. Hand-written rather than auto-derived because the
 * stripped HTML loses too much structure. Sent to spam-filter-conservative
 * clients (Outlook 2007, some corporate gateways) and rendered as the
 * accessible alt.
 */
export function inviteEmailText(props: InviteEmailProps): string {
  const lines = [
    `${props.inviterName} invited you to a trip on MonkeyTravel.`,
    "",
    `Trip: ${props.tripTitle || props.tripDestination}`,
    props.tripDates ? `Dates: ${props.tripDates}` : "",
    `Role: ${props.role} — ${ROLE_DESCRIPTION[props.role]}`,
    "",
    props.message ? `Note from ${props.inviterName}:` : "",
    props.message ? `  "${props.message}"` : "",
    props.message ? "" : "",
    `Open the trip: ${props.inviteUrl}`,
    "",
    "—",
    "MonkeyTravel · AI-powered trip planning",
    `Manage preferences: ${APP_URL}/profile/notifications`,
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

// Inline styles
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

const smallText: React.CSSProperties = {
  fontSize: "12px",
  color: "#888888",
  lineHeight: 1.5,
  margin: "16px 0 0",
  wordBreak: "break-all",
};

const linkText: React.CSSProperties = {
  color: "#FF6B6B",
};

const messageBox: React.CSSProperties = {
  backgroundColor: "#FFFAF5",
  borderLeft: "3px solid #FF6B6B",
  borderRadius: "4px",
  padding: "16px 20px",
  margin: "20px 0",
};

const messageText: React.CSSProperties = {
  fontSize: "15px",
  fontStyle: "italic",
  color: "#444444",
  lineHeight: 1.6,
  margin: "0 0 8px",
};

const messageAttribution: React.CSSProperties = {
  fontSize: "13px",
  color: "#888888",
  margin: 0,
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
