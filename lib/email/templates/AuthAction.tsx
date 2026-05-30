/**
 * Generic auth-action email (password reset, magic link, email change,
 * reauthentication, invite). Sent from the Supabase "Send Email" hook for
 * every auth email type that isn't the richer signup-confirmation template.
 *
 * Copy is driven by `kind` + `locale` (see lib/email/copy.ts) so all
 * variants share one branded shell (EmailLayout) and one code path.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import {
  authActionCopy,
  authSharedCopy,
  layoutCopy,
  type AuthActionKind,
  type EmailLocale,
} from "../copy";

export type { AuthActionKind };

export interface AuthActionEmailProps {
  kind: AuthActionKind;
  /** Absolute action URL (Supabase verify link). */
  actionUrl: string;
  /** Optional 6-digit OTP code, when Supabase provides one. */
  token?: string;
  /** Recipient UI language. Defaults to English. */
  locale?: EmailLocale;
}

export default function AuthActionEmail({
  kind,
  actionUrl,
  token,
  locale = "en",
}: AuthActionEmailProps) {
  const copy = authActionCopy[locale][kind];
  const shared = authSharedCopy[locale];
  // Strip a trailing emoji for the (text-only) preview line.
  const preview = copy.heading.replace(/\s\p{Emoji_Presentation}+$/u, "");

  return (
    <EmailLayout preview={preview} locale={locale}>
      <Heading as="h1" style={h1}>
        {copy.heading}
      </Heading>

      <Text style={leadText}>{copy.lead}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={actionUrl} style={button}>
          {copy.cta}
        </Button>
      </Section>

      {token && (
        <Section style={codeBox}>
          <Text style={codeLabel}>{shared.codeLabel}</Text>
          <Text style={codeText}>{token}</Text>
        </Section>
      )}

      <Text style={smallText}>
        {shared.linkFallback}
        <br />
        <span style={linkText}>{actionUrl}</span>
      </Text>

      {copy.footer && <Text style={smallText}>{copy.footer}</Text>}
    </EmailLayout>
  );
}

/** Plain-text fallback. */
export function authActionEmailText(props: AuthActionEmailProps): string {
  const locale = props.locale ?? "en";
  const copy = authActionCopy[locale][props.kind];
  return [
    copy.heading,
    "",
    copy.lead,
    "",
    `${copy.cta}: ${props.actionUrl}`,
    props.token ? `\n${authSharedCopy[locale].codeLabel} ${props.token}` : "",
    copy.footer ? `\n${copy.footer}` : "",
    "",
    "—",
    "MonkeyTravel · " + layoutCopy[locale].tagline,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Subject line per action kind, in the recipient's language. */
export function authActionSubject(
  kind: AuthActionKind,
  locale: EmailLocale = "en"
): string {
  return authActionCopy[locale][kind].subject;
}

// Inline styles — mirror the other templates.
const h1: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  color: "#1A1A1A",
  margin: "0 0 16px",
  lineHeight: 1.3,
};

const leadText: React.CSSProperties = {
  fontSize: "17px",
  color: "#444444",
  margin: "0 0 8px",
  lineHeight: 1.6,
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

const codeBox: React.CSSProperties = {
  backgroundColor: "#FFFAF5",
  border: "1px solid #F0E6DC",
  borderRadius: "12px",
  padding: "16px",
  margin: "8px 0 24px",
  textAlign: "center",
};

const codeLabel: React.CSSProperties = {
  fontSize: "12px",
  color: "#888888",
  margin: "0 0 6px",
};

const codeText: React.CSSProperties = {
  fontSize: "28px",
  fontWeight: 800,
  letterSpacing: "6px",
  color: "#1A1A1A",
  margin: 0,
};
