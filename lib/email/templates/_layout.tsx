/**
 * Shared layout for all transactional emails.
 *
 * Wraps any email content with: brand header, white content card on a
 * warm background, footer with the company name + a generic "manage
 * preferences" link. The unsubscribe link is currently a placeholder
 * (/profile/notifications) — when the HMAC unsubscribe endpoint ships,
 * marketing emails will pass a tokenized URL via the `unsubscribeUrl`
 * prop instead.
 *
 * Tested with the React Email preview tool. Mobile-clamped at 600px
 * (the de-facto webmail standard); inline styles only because Gmail
 * strips <style> tags from <head>.
 */

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

interface EmailLayoutProps {
  /** Preview text — shown by webmail clients next to the subject. */
  preview: string;
  /**
   * Per-email unsubscribe URL. For transactional emails this can be the
   * generic /profile/notifications page; for marketing emails the
   * orchestrator passes a one-click HMAC link.
   */
  unsubscribeUrl?: string;
  children: ReactNode;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export function EmailLayout({
  preview,
  unsubscribeUrl,
  children,
}: EmailLayoutProps) {
  const finalUnsubscribeUrl =
    unsubscribeUrl ?? `${APP_URL}/profile/notifications`;

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Link href={APP_URL} style={{ textDecoration: "none" }}>
              <Img
                src={`${APP_URL}/icon-192.png`}
                alt="MonkeyTravel"
                width="40"
                height="40"
                style={{ marginRight: "8px", verticalAlign: "middle" }}
              />
              <Text style={brandText}>MonkeyTravel</Text>
            </Link>
          </Section>

          {/* Card */}
          <Section style={card}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            <Hr style={hr} />
            <Text style={footerText}>
              You're receiving this because you have an active MonkeyTravel
              account.{" "}
              <Link href={finalUnsubscribeUrl} style={footerLink}>
                Manage preferences
              </Link>
            </Text>
            <Text style={footerText}>
              MonkeyTravel · AI-powered trip planning
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Inline-style objects (React Email best practice — Gmail strips <style>).
const body: React.CSSProperties = {
  backgroundColor: "#FFFAF5",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "32px 16px",
};

const header: React.CSSProperties = {
  textAlign: "center",
  paddingBottom: "16px",
};

const brandText: React.CSSProperties = {
  display: "inline-block",
  color: "#FF6B6B",
  fontWeight: 700,
  fontSize: "20px",
  margin: 0,
  verticalAlign: "middle",
};

const card: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "16px",
  padding: "32px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
};

const footer: React.CSSProperties = {
  textAlign: "center",
  paddingTop: "24px",
};

const hr: React.CSSProperties = {
  borderColor: "#E5E5E5",
  marginBottom: "16px",
};

const footerText: React.CSSProperties = {
  color: "#888888",
  fontSize: "12px",
  margin: "4px 0",
  lineHeight: 1.5,
};

const footerLink: React.CSSProperties = {
  color: "#FF6B6B",
  textDecoration: "underline",
};
