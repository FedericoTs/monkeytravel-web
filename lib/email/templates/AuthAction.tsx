/**
 * Generic auth-action email (password reset, magic link, email change,
 * reauthentication, invite). Sent from the Supabase "Send Email" hook for
 * every auth email type that isn't the richer signup-confirmation template.
 *
 * Copy is driven by `kind` + `locale` (see lib/email/copy.ts) so all
 * variants share one branded shell (EmailLayout) and one code path.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout, otpCodeBox, otpCodeLabel, otpCodeText } from "./_layout";
import {
  authActionCopy,
  authSharedCopy,
  layoutCopy,
  type AuthActionKind,
  type EmailLocale,
} from "../copy";
import { h1, linkText, largeButton as button } from "./_styles";

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
    <EmailLayout preview={preview} locale={locale} footerCopy={{ reason: layoutCopy[locale].footerReasonAddress, link: layoutCopy[locale].manage }}>
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
        <Section style={otpCodeBox}>
          <Text style={otpCodeLabel}>{shared.codeLabel}</Text>
          <Text style={otpCodeText}>{token}</Text>
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

// This email's own inline styles; the shared ones are in ./_styles.
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

