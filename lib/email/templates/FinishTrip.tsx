/**
 * "Finish your first trip": one email to a new account that still owns no
 * trip about a day after signup (lib/notifications/finish-trip.ts). Marketing,
 * so it is gated on marketingNotifications (lib/email/send.ts). String props
 * only: the sender resolves the copy in the recipient's language.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { layoutCopy, type EmailLocale } from "../copy";
import { h1, bodyText, signOff, button } from "./_styles";

export interface FinishTripEmailProps {
  heading: string;
  body: string;
  ctaLabel: string;
  /** The planner, with the destination prefilled when one is known. */
  ctaUrl: string;
  /** The localized team sign-off. */
  signoff: string;
  /** Optional pre-built HMAC unsubscribe URL (key='marketingNotifications'). */
  unsubscribeUrl?: string;
  locale?: EmailLocale;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function FinishTripEmail({
  heading,
  body,
  ctaLabel,
  ctaUrl,
  signoff,
  unsubscribeUrl,
  locale = "en",
}: FinishTripEmailProps) {
  return (
    <EmailLayout
      preview={body}
      unsubscribeUrl={unsubscribeUrl ?? `${APP_URL}/profile/notifications`}
      locale={locale}
    >
      <Heading as="h1" style={h1}>
        {heading}
      </Heading>

      <Text style={bodyText}>{body}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={ctaUrl} style={button}>
          {ctaLabel}
        </Button>
      </Section>

      <Text style={signOff}>— {signoff}</Text>
    </EmailLayout>
  );
}

/** The subject is the heading, which already reads as a full sentence. */
export function finishTripSubject(props: { heading: string }): string {
  return props.heading;
}

export function finishTripEmailText(props: FinishTripEmailProps): string {
  const copy = layoutCopy[props.locale ?? "en"];
  return [
    props.heading,
    "",
    props.body,
    "",
    `${props.ctaLabel}: ${props.ctaUrl}`,
    "",
    `— ${props.signoff}`,
    "",
    "—",
    `MonkeyTravel · ${copy.tagline}`,
    `${copy.manage}: ${props.unsubscribeUrl ?? `${APP_URL}/profile/notifications`}`,
  ].join("\n");
}

