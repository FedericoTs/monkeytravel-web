/**
 * Signup confirmation ("verify your email") template.
 *
 * Unlike the invite/vote/reminder templates, the confirmation link is
 * minted by Supabase Auth (GoTrue), not our app — so this template is
 * delivered one of two ways:
 *
 *   A. Pasted into the Supabase dashboard "Confirm signup" template,
 *      with `confirmUrl` swapped for the `{{ .ConfirmationURL }}` Go
 *      template variable. Render with confirmUrl="{{ .ConfirmationURL }}".
 *   B. Sent from a Supabase "Send Email" auth hook route that renders
 *      this with the real action link Supabase passes in the webhook.
 *
 * Localized via the `locale` prop (copy in lib/email/copy.ts).
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { confirmSignupCopy, layoutCopy, type EmailLocale } from "../copy";

export interface ConfirmSignupEmailProps {
  /** Display name if known (falls back to a generic greeting). */
  name?: string;
  /**
   * Absolute confirmation URL. For the dashboard template, pass the
   * literal "{{ .ConfirmationURL }}" so Supabase substitutes it.
   */
  confirmUrl: string;
  /** Recipient UI language. Defaults to English. */
  locale?: EmailLocale;
}

export default function ConfirmSignupEmail({
  name,
  confirmUrl,
  locale = "en",
}: ConfirmSignupEmailProps) {
  const t = confirmSignupCopy[locale];
  const preview = t.lead;

  return (
    <EmailLayout preview={preview} locale={locale}>
      <Heading as="h1" style={h1}>
        {name ? t.welcomeNamed(name) : t.welcome}
      </Heading>

      <Text style={leadText}>{t.lead}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={confirmUrl} style={button}>
          {t.cta}
        </Button>
      </Section>

      <Text style={bodyText}>{t.body}</Text>

      <Text style={smallText}>
        {t.linkFallback}
        <br />
        <span style={linkText}>{confirmUrl}</span>
      </Text>

      <Text style={smallText}>{t.ignore}</Text>
    </EmailLayout>
  );
}

/** Plain-text fallback. */
export function confirmSignupEmailText(props: ConfirmSignupEmailProps): string {
  const t = confirmSignupCopy[props.locale ?? "en"];
  return [
    props.name ? t.welcomeNamed(props.name) : t.welcome,
    "",
    t.lead,
    "",
    `${t.cta}: ${props.confirmUrl}`,
    "",
    t.body,
    "",
    t.ignore,
    "",
    "—",
    "MonkeyTravel · " + layoutCopy[props.locale ?? "en"].tagline,
  ].join("\n");
}

/** Subject line in the recipient's language. */
export function confirmSignupSubject(locale: EmailLocale = "en"): string {
  return confirmSignupCopy[locale].subject;
}

// Inline styles — mirror the invite/vote/reminder templates.
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
  margin: "0 0 8px",
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
  lineHeight: 1.6,
  margin: "16px 0 0",
  wordBreak: "break-all",
};

const linkText: React.CSSProperties = {
  color: "#FF6B6B",
};

const button: React.CSSProperties = {
  backgroundColor: "#FF6B6B",
  color: "#FFFFFF",
  padding: "14px 36px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: "16px",
  display: "inline-block",
  boxShadow: "0 4px 12px rgba(255,107,107,0.35)",
};
