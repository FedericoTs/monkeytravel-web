/**
 * Blog digest ("best of / recent posts") — a MARKETING email.
 *
 * Sent via Resend Broadcasts to an opted-in audience (NOT through the
 * transactional pipeline). Send from the dedicated marketing subdomain to
 * keep auth/transactional deliverability isolated. See docs/MARKETING_EMAILS.md.
 *
 * Prop-driven so it can be rendered from the blog source (scripts) or a
 * broadcast composer. When used as a Resend Broadcast, pass
 * unsubscribeUrl="{{{RESEND_UNSUBSCRIBE_URL}}}" so Resend injects the
 * required one-click unsubscribe link.
 */

import {
  Button,
  Heading,
  Hr,
  Img,
  Link,
  Section,
  Text,
} from "@react-email/components";
import { EmailLayout } from "./_layout";
import { blogEmailCopy, type EmailLocale } from "../copy";

export interface BlogPostCard {
  title: string;
  excerpt: string;
  /** Absolute URL to the post. */
  url: string;
  /** Absolute image URL (or omit). */
  imageUrl?: string;
  category?: string;
  readingTime?: number;
}

export interface BlogDigestEmailProps {
  locale?: EmailLocale;
  /** Optional override for the intro paragraph. */
  intro?: string;
  posts: BlogPostCard[];
  /** Absolute URL to the blog index. */
  blogUrl: string;
  unsubscribeUrl?: string;
}

export default function BlogDigestEmail({
  locale = "en",
  intro,
  posts,
  blogUrl,
  unsubscribeUrl,
}: BlogDigestEmailProps) {
  const t = blogEmailCopy[locale];

  return (
    <EmailLayout
      preview={t.digestIntro}
      locale={locale}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading as="h1" style={h1}>
        {t.digestHeading}
      </Heading>
      <Text style={introText}>{intro ?? t.digestIntro}</Text>

      {posts.map((post, i) => (
        <Section key={post.url} style={i > 0 ? cardSpaced : card}>
          {post.imageUrl && (
            <Link href={post.url}>
              <Img
                src={post.imageUrl}
                alt={post.title}
                width="536"
                style={cardImage}
              />
            </Link>
          )}
          <Text style={metaLine}>
            {[post.category, post.readingTime ? t.minRead(post.readingTime) : null]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
          <Link href={post.url} style={{ textDecoration: "none" }}>
            <Text style={cardTitle}>{post.title}</Text>
          </Link>
          <Text style={cardExcerpt}>{post.excerpt}</Text>
          <Link href={post.url} style={readLink}>
            {t.readArticle}
          </Link>
        </Section>
      ))}

      <Hr style={hr} />
      <Section style={{ textAlign: "center", margin: "8px 0 0" }}>
        <Button href={blogUrl} style={button}>
          {t.browseAll}
        </Button>
      </Section>
    </EmailLayout>
  );
}

/** Plain-text fallback. */
export function blogDigestEmailText(props: BlogDigestEmailProps): string {
  const t = blogEmailCopy[props.locale ?? "en"];
  const lines = [t.digestHeading, "", props.intro ?? t.digestIntro, ""];
  for (const p of props.posts) {
    lines.push(`• ${p.title}`);
    lines.push(`  ${p.excerpt}`);
    lines.push(`  ${p.url}`);
    lines.push("");
  }
  lines.push(`${t.browseAll}: ${props.blogUrl}`);
  return lines.join("\n");
}

export function blogDigestSubject(locale: EmailLocale = "en"): string {
  return blogEmailCopy[locale].digestSubject;
}

// Inline styles.
const h1: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 800,
  color: "#1A1A1A",
  margin: "0 0 8px",
  lineHeight: 1.3,
};

const introText: React.CSSProperties = {
  fontSize: "16px",
  color: "#555555",
  lineHeight: 1.6,
  margin: "0 0 8px",
};

const card: React.CSSProperties = {
  marginTop: "24px",
};

const cardSpaced: React.CSSProperties = {
  marginTop: "32px",
  borderTop: "1px solid #F0E6DC",
  paddingTop: "24px",
};

const cardImage: React.CSSProperties = {
  width: "100%",
  maxWidth: "536px",
  height: "auto",
  borderRadius: "12px",
  display: "block",
  marginBottom: "12px",
};

const metaLine: React.CSSProperties = {
  fontSize: "12px",
  color: "#FF6B6B",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  margin: "0 0 6px",
};

const cardTitle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: "#1A1A1A",
  lineHeight: 1.3,
  margin: "0 0 8px",
};

const cardExcerpt: React.CSSProperties = {
  fontSize: "15px",
  color: "#444444",
  lineHeight: 1.6,
  margin: "0 0 10px",
};

const readLink: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "#FF6B6B",
  textDecoration: "none",
};

const hr: React.CSSProperties = {
  borderColor: "#F0E6DC",
  margin: "32px 0 24px",
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
