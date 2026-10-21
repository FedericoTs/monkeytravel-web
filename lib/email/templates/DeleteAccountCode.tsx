/**
 * The code that confirms deleting an account, sent from the profile page's
 * delete dialog. It carries no link: the code is typed into the dialog, and a
 * link would sign the person in rather than delete anything.
 */

import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, otpCodeBox, otpCodeLabel, otpCodeText } from "./_layout";
import { deleteAccountCodeCopy, layoutCopy, type EmailLocale } from "../copy";

export interface DeleteAccountCodeEmailProps {
  code: string;
  locale?: EmailLocale;
}

export default function DeleteAccountCodeEmail({
  code,
  locale = "en",
}: DeleteAccountCodeEmailProps) {
  const copy = deleteAccountCodeCopy[locale];

  return (
    <EmailLayout preview={copy.heading} locale={locale}>
      <Heading as="h1" style={h1}>
        {copy.heading}
      </Heading>

      <Text style={leadText}>{copy.lead}</Text>

      <Section style={otpCodeBox}>
        <Text style={otpCodeLabel}>{copy.codeLabel}</Text>
        <Text style={otpCodeText}>{code}</Text>
      </Section>

      <Text style={smallText}>{copy.footer}</Text>
    </EmailLayout>
  );
}

/** Plain-text fallback. */
export function deleteAccountCodeEmailText({
  code,
  locale = "en",
}: DeleteAccountCodeEmailProps): string {
  const copy = deleteAccountCodeCopy[locale];
  return [
    copy.heading,
    "",
    copy.lead,
    "",
    `${copy.codeLabel} ${code}`,
    "",
    copy.footer,
    "",
    "—",
    "MonkeyTravel · " + layoutCopy[locale].tagline,
  ].join("\n");
}

export function deleteAccountCodeSubject(locale: EmailLocale = "en"): string {
  return deleteAccountCodeCopy[locale].subject;
}

// Inline styles — mirror AuthAction.
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
  margin: "0 0 16px",
  lineHeight: 1.6,
};

const smallText: React.CSSProperties = {
  fontSize: "12px",
  color: "#888888",
  lineHeight: 1.6,
  margin: "16px 0 0",
};
