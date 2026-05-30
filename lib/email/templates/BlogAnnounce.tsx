/**
 * Single new-post announcement — a MARKETING email.
 *
 * Like BlogDigest, sent via Resend Broadcasts to an opted-in audience from
 * the marketing subdomain. Pass unsubscribeUrl="{{{RESEND_UNSUBSCRIBE_URL}}}"
 * when rendering for a Resend Broadcast. See docs/MARKETING_EMAILS.md.
 */

import { Button, Heading, Img, Link, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { blogEmailCopy, type EmailLocale } from "../copy";
import type { BlogPostCard } from "./BlogDigest";

export interface BlogAnnounceEmailProps {
  locale?: EmailLocale;
  post: BlogPostCard & { author?: string };
  /** Absolute URL to the blog index (for the secondary link). */
  blogUrl: string;
  unsubscribeUrl?: string;
}

export default function BlogAnnounceEmail({
  locale = "en",
  post,
  blogUrl,
  unsubscribeUrl,
}: BlogAnnounceEmailProps) {
  const t = blogEmailCopy[locale];

  return (
    <EmailLayout
      preview={t.announcePreview(post.title)}
      locale={locale}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={label}>{t.newPostLabel}</Text>

      {post.imageUrl && (
        <Link href={post.url}>
          <Img src={post.imageUrl} alt={post.title} width="536" style={hero} />
        </Link>
      )}

      <Heading as="h1" style={h1}>
        {post.title}
      </Heading>

      <Text style={metaLine}>
        {[post.author, post.readingTime ? t.minRead(post.readingTime) : null]
          .filter(Boolean)
          .join("  ·  ")}
      </Text>

      <Text style={excerpt}>{post.excerpt}</Text>

      <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
        <Button href={post.url} style={button}>
          {t.readArticle.replace(" →", "")}
        </Button>
      </Section>

      <Section style={{ textAlign: "center" }}>
        <Link href={blogUrl} style={secondaryLink}>
          {t.browseAll}
        </Link>
      </Section>
    </EmailLayout>
  );
}

/** Plain-text fallback. */
export function blogAnnounceEmailText(props: BlogAnnounceEmailProps): string {
  const t = blogEmailCopy[props.locale ?? "en"];
  return [
    t.newPostLabel,
    "",
    props.post.title,
    "",
    props.post.excerpt,
    "",
    `${t.readArticle.replace(" →", "")}: ${props.post.url}`,
    "",
    `${t.browseAll}: ${props.blogUrl}`,
  ].join("\n");
}

export function blogAnnounceSubject(
  title: string,
  locale: EmailLocale = "en"
): string {
  return blogEmailCopy[locale].announceSubject(title);
}

// Inline styles.
const label: React.CSSProperties = {
  fontSize: "12px",
  color: "#FF6B6B",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "1px",
  margin: "0 0 12px",
};

const hero: React.CSSProperties = {
  width: "100%",
  maxWidth: "536px",
  height: "auto",
  borderRadius: "12px",
  display: "block",
  marginBottom: "20px",
};

const h1: React.CSSProperties = {
  fontSize: "26px",
  fontWeight: 800,
  color: "#1A1A1A",
  lineHeight: 1.25,
  margin: "0 0 8px",
};

const metaLine: React.CSSProperties = {
  fontSize: "13px",
  color: "#888888",
  margin: "0 0 16px",
};

const excerpt: React.CSSProperties = {
  fontSize: "16px",
  color: "#444444",
  lineHeight: 1.7,
  margin: "0 0 8px",
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

const secondaryLink: React.CSSProperties = {
  fontSize: "14px",
  color: "#888888",
  textDecoration: "underline",
};
