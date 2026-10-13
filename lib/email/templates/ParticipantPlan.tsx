/**
 * "Here's the plan": sent once per trip to an address someone gives on the
 * trip's share link (lib/participants/plan-email.ts). It hands them the link,
 * so the plan is in their inbox and not only in the chat it was sent to.
 *
 * String props only, like TripDayDigest: the sender passes translated copy.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import type { EmailLocale } from "../copy";

export interface ParticipantPlanEmailProps {
  /** "Lisbon: here's the plan". Also the subject. */
  heading: string;
  /** The trip's dates, e.g. "Nov 12 – Nov 18"; empty when it has none. */
  dates: string;
  intro: string;
  /** The daily-plan line, only while those emails go to participants. */
  digestLine?: string;
  ctaLabel: string;
  /** The share link the email was given on. */
  planUrl: string;
  /** Why they get this, and the label of the link that stops it. */
  footerReason: string;
  footerLink: string;
  /** Their link that stops this trip's emails. */
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

export default function ParticipantPlanEmail({
  heading,
  dates,
  intro,
  digestLine,
  ctaLabel,
  planUrl,
  footerReason,
  footerLink,
  unsubscribeUrl,
  locale = "en",
}: ParticipantPlanEmailProps) {
  return (
    <EmailLayout
      preview={dates ? `${heading} · ${dates}` : heading}
      unsubscribeUrl={unsubscribeUrl}
      locale={locale}
      footerCopy={{ reason: footerReason, link: footerLink }}
    >
      <Heading as="h1" style={h1}>
        {heading}
      </Heading>

      {dates ? <Text style={leadText}>{dates}</Text> : null}

      <Text style={bodyText}>{intro}</Text>

      {digestLine ? <Text style={bodyText}>{digestLine}</Text> : null}

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={planUrl} style={button}>
          {ctaLabel}
        </Button>
      </Section>
    </EmailLayout>
  );
}

export function participantPlanSubject(props: Pick<ParticipantPlanEmailProps, "heading">): string {
  return props.heading;
}

/** Plain-text fallback. */
export function participantPlanEmailText(props: ParticipantPlanEmailProps): string {
  return [
    props.heading,
    ...(props.dates ? ["", props.dates] : []),
    "",
    props.intro,
    ...(props.digestLine ? ["", props.digestLine] : []),
    "",
    `${props.ctaLabel}: ${props.planUrl}`,
    "",
    "—",
    props.footerReason,
    ...(props.unsubscribeUrl ? [`${props.footerLink}: ${props.unsubscribeUrl}`] : []),
  ].join("\n");
}

// Inline styles, the same as TripDayDigest's.

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
