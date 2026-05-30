/**
 * Shared layout for all transactional + notification emails.
 *
 * Wraps any email content with a branded header (logo lockup + tagline),
 * a thin rainbow brand stripe, a white content card on a warm-cream
 * background, and a refined footer. Every email in the app renders the
 * same brand language through this shell.
 *
 * Design notes:
 *   - Inline styles only — Gmail strips <style> from <head>.
 *   - 600px container (de-facto webmail standard), mobile-fluid below.
 *   - "Bulletproof" structure (tables via Section/Row/Column) so the
 *     rainbow stripe + header render identically across Gmail, Apple
 *     Mail, Outlook, and corporate gateways.
 *   - Logo is loaded from an absolute https URL (email clients can't
 *     resolve relative paths). NEXT_PUBLIC_APP_URL drives it.
 *   - Brand palette mirrors app/globals.css "Fresh Voyager" theme:
 *       coral  #FF6B6B (primary)   gold #FFD93D (accent)
 *       teal   #00B4A6 (secondary) navy #2D3436 (ink)
 *       cream  #FFFAF5 (canvas)
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
  Row,
  Column,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { layoutCopy, type EmailLocale } from "../copy";

interface EmailLayoutProps {
  /** Preview text — shown by webmail clients next to the subject. */
  preview: string;
  /**
   * Per-email unsubscribe URL. For transactional emails this can be the
   * generic /profile/notifications page; for marketing emails the
   * orchestrator passes a one-click HMAC link.
   */
  unsubscribeUrl?: string;
  /** UI language of the recipient. Localizes the shell (tagline/footer). */
  locale?: EmailLocale;
  children: ReactNode;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

// Brand palette — keep in sync with app/globals.css "Fresh Voyager".
const BRAND = {
  coral: "#FF6B6B",
  coralDark: "#E85555",
  gold: "#FFD93D",
  teal: "#00B4A6",
  sky: "#4A90D9",
  indigo: "#9B6BD9",
  ink: "#2D3436",
  inkMuted: "#636E72",
  cream: "#FFFAF5",
  line: "#F0E6DC",
} as const;

/** Travel-rainbow brand signature (echoes the wordmark lockup stripe). */
const RAINBOW = [
  BRAND.coral,
  BRAND.gold,
  BRAND.teal,
  BRAND.sky,
  BRAND.indigo,
] as const;

export function EmailLayout({
  preview,
  unsubscribeUrl,
  locale = "en",
  children,
}: EmailLayoutProps) {
  const finalUnsubscribeUrl =
    unsubscribeUrl ?? `${APP_URL}/profile/notifications`;
  const t = layoutCopy[locale];

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header — logo lockup */}
          <Section style={header}>
            <Link href={APP_URL} style={{ textDecoration: "none" }}>
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                align="center"
                style={{ margin: "0 auto" }}
              >
                <tbody>
                  <tr>
                    <td style={{ verticalAlign: "middle", paddingRight: "10px" }}>
                      <Img
                        src={`${APP_URL}/images/logo.png`}
                        alt="MonkeyTravel"
                        width="44"
                        height="44"
                        style={{ display: "block", borderRadius: "10px" }}
                      />
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <span style={wordmarkMonkey}>Monkey</span>
                      <span style={wordmarkTravel}>Travel</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Link>
            <Text style={tagline}>{t.tagline}</Text>
          </Section>

          {/* Rainbow brand stripe */}
          <Row style={stripe}>
            {RAINBOW.map((c) => (
              <Column key={c} style={{ backgroundColor: c, height: "4px" }} />
            ))}
          </Row>

          {/* Card */}
          <Section style={card}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            <Hr style={hr} />
            <Text style={footerText}>
              {t.footerReason}{" "}
              <Link href={finalUnsubscribeUrl} style={footerLink}>
                {t.manage}
              </Link>
            </Text>
            <Text style={footerBrand}>
              <Link href={APP_URL} style={footerBrandLink}>
                MonkeyTravel
              </Link>{" "}
              · {t.tagline}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ── Inline-style objects ──────────────────────────────────────────────

const body: React.CSSProperties = {
  backgroundColor: BRAND.cream,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "32px 16px 24px",
};

const header: React.CSSProperties = {
  textAlign: "center",
  paddingBottom: "16px",
};

const wordmarkMonkey: React.CSSProperties = {
  color: BRAND.ink,
  fontWeight: 800,
  fontSize: "22px",
  letterSpacing: "-0.3px",
};

const wordmarkTravel: React.CSSProperties = {
  color: BRAND.coral,
  fontWeight: 800,
  fontSize: "22px",
  letterSpacing: "-0.3px",
};

const tagline: React.CSSProperties = {
  color: BRAND.inkMuted,
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.3px",
  margin: "10px 0 0",
};

const stripe: React.CSSProperties = {
  maxWidth: "600px",
  borderRadius: "4px",
  overflow: "hidden",
  marginBottom: "16px",
};

const card: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "16px",
  padding: "36px 32px",
  border: `1px solid ${BRAND.line}`,
  boxShadow: "0 4px 16px rgba(45,52,54,0.06)",
};

const footer: React.CSSProperties = {
  textAlign: "center",
  paddingTop: "24px",
};

const hr: React.CSSProperties = {
  borderColor: BRAND.line,
  marginBottom: "16px",
};

const footerText: React.CSSProperties = {
  color: BRAND.inkMuted,
  fontSize: "12px",
  margin: "4px 0",
  lineHeight: 1.5,
};

const footerBrand: React.CSSProperties = {
  color: BRAND.inkMuted,
  fontSize: "12px",
  margin: "4px 0",
  lineHeight: 1.5,
};

const footerLink: React.CSSProperties = {
  color: BRAND.coral,
  textDecoration: "underline",
};

const footerBrandLink: React.CSSProperties = {
  color: BRAND.inkMuted,
  fontWeight: 700,
  textDecoration: "none",
};
