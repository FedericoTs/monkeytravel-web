/**
 * Feedback-outreach email.
 *
 * A warm, personal "we'd love your feedback" message sent to engaged users
 * (people who've actually planned a trip). The ask: two minutes of honest
 * feedback to shape what we build next.
 *
 * This is research/marketing outreach — NOT transactional. It's gated on
 * users.notification_settings.marketingNotifications via the send
 * orchestrator (NOTIFICATION_SETTING_KEY + UNSUB_KEY), so the recipient's
 * marketing opt-out is always honoured and a one-click unsubscribe link is
 * minted into the footer.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { feedbackOutreachCopy, layoutCopy, type EmailLocale } from "../copy";

export interface FeedbackOutreachEmailProps {
  /** Recipient's first name. Omitted → a name-less greeting is used. */
  firstName?: string;
  /** Pre-built absolute URL to /feedback/[token]. */
  feedbackUrl: string;
  /**
   * Optional pre-built HMAC one-click unsubscribe URL. This is marketing
   * outreach, so the orchestrator mints a tokenized link (user_id known +
   * secret configured) and passes it here; otherwise the layout falls back
   * to the generic /profile/notifications URL.
   */
  unsubscribeUrl?: string;
  /** Recipient UI language — localizes the copy + shared shell. */
  locale?: EmailLocale;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export default function FeedbackOutreachEmail({
  firstName,
  feedbackUrl,
  unsubscribeUrl,
  locale = "en",
}: FeedbackOutreachEmailProps) {
  const t = feedbackOutreachCopy[locale];

  return (
    <EmailLayout
      preview={t.preview}
      unsubscribeUrl={unsubscribeUrl ?? `${APP_URL}/profile/notifications`}
      locale={locale}
    >
      <Heading as="h1" style={h1}>
        {t.heading(firstName)}
      </Heading>

      <Text style={leadText}>{t.lead}</Text>

      <Text style={bodyText}>{t.body}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={feedbackUrl} style={button}>
          {t.cta}
        </Button>
      </Section>

      <Text style={smallText}>
        {t.copyLink} <span style={linkText}>{feedbackUrl}</span>
      </Text>

      <Text style={signOff}>— The MonkeyTravel Team</Text>
    </EmailLayout>
  );
}

/**
 * Plain-text fallback. Hand-written rather than auto-derived because the
 * stripped HTML loses too much structure. Sent to spam-filter-conservative
 * clients (Outlook 2007, some corporate gateways) and rendered as the
 * accessible alt.
 */
export function feedbackOutreachEmailText(
  props: FeedbackOutreachEmailProps
): string {
  const locale = props.locale ?? "en";
  const t = feedbackOutreachCopy[locale];
  const lines = [
    t.heading(props.firstName),
    "",
    t.lead,
    "",
    t.body,
    "",
    `${t.cta}: ${props.feedbackUrl}`,
    "",
    "— The MonkeyTravel Team",
    "",
    "—",
    `MonkeyTravel · ${layoutCopy[locale].tagline}`,
  ];
  return lines.join("\n");
}

/** Localized subject line — personalized with the recipient's first name. */
export function feedbackOutreachSubject(
  locale: EmailLocale = "en",
  firstName?: string
): string {
  return feedbackOutreachCopy[locale].subject(firstName);
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
  margin: "0 0 20px",
  fontWeight: 600,
  lineHeight: 1.5,
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

const signOff: React.CSSProperties = {
  fontSize: "15px",
  color: "#555555",
  fontWeight: 600,
  margin: "28px 0 0",
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
