/**
 * Must-dos from someone going: sent to a trip's owner when a person who said
 * they're going on the share link adds what they don't want to miss.
 * Collaboration, like a vote, and stopped by the same switch (collabVotes).
 * At most one a trip a day (lib/notifications/picks-email.ts).
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { picksAddedCopy, layoutCopy, type EmailLocale } from "../copy";
import { button } from "./_styles";

export interface PicksAddedEmailProps {
  /** The name they gave on the share link, if any. */
  guestName: string | null;
  /** What they don't want to miss, as they typed it (1 to 3). */
  picks: string[];
  tripTitle: string;
  tripDestination: string;
  /** The trip page, opened on the card that adds the picks. */
  tripUrl: string;
  /** One-click unsubscribe (key collabVotes), when the orchestrator can sign one. */
  unsubscribeUrl?: string;
  /** Recipient UI language — localizes the shared shell. */
  locale?: EmailLocale;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function PicksAddedEmail({
  guestName,
  picks,
  tripTitle,
  tripDestination,
  tripUrl,
  unsubscribeUrl,
  locale = "en",
}: PicksAddedEmailProps) {
  const t = picksAddedCopy[locale];
  const heading = t.heading(guestName);

  return (
    <EmailLayout
      preview={`${heading}: ${picks.join(", ")}`}
      unsubscribeUrl={unsubscribeUrl ?? `${APP_URL}/profile/notifications`}
      locale={locale}
    >
      <Heading as="h1" style={h1}>
        {heading}
      </Heading>

      <Section style={tripBox}>
        <Text style={tripLabel}>{tripTitle ? `"${tripTitle}"` : tripDestination}</Text>
        {picks.map((pick, i) => (
          <Text key={i} style={pickText}>
            {pick}
          </Text>
        ))}
      </Section>

      <Text style={leadText}>{t.howTo}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={tripUrl} style={button}>
          {t.cta}
        </Button>
      </Section>

      <Text style={smallText}>
        {t.turnOffPrefix}{" "}
        <a href={`${APP_URL}/profile/notifications`} style={linkText}>
          {t.turnOffLink}
        </a>
        .
      </Text>
    </EmailLayout>
  );
}

/** Plain-text fallback. Hand-written. */
export function picksAddedEmailText(props: PicksAddedEmailProps): string {
  const locale = props.locale ?? "en";
  const t = picksAddedCopy[locale];
  return [
    `${t.heading(props.guestName)}:`,
    ...props.picks.map((pick) => `- ${pick}`),
    "",
    props.tripTitle || props.tripDestination,
    t.howTo,
    "",
    `${t.cta}: ${props.tripUrl}`,
    "",
    "—",
    `MonkeyTravel · ${layoutCopy[locale].tagline}`,
  ].join("\n");
}

/** Localized subject line. */
export function picksAddedSubject(destination: string, locale: EmailLocale = "en"): string {
  return picksAddedCopy[locale].subject(destination);
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
  margin: "0 0 8px",
};

const pickText: React.CSSProperties = {
  fontSize: "17px",
  fontWeight: 600,
  color: "#1A1A1A",
  margin: "0 0 4px",
  lineHeight: 1.4,
};

const smallText: React.CSSProperties = {
  fontSize: "12px",
  color: "#888888",
  margin: "24px 0 0",
  lineHeight: 1.5,
};

// Coral is decoration only: a small link in it is hard to read on white.
const linkText: React.CSSProperties = {
  color: "#555555",
  textDecoration: "underline",
};
