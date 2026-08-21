import { getTranslations, getLocale } from "next-intl/server";

/**
 * Visible "Last updated <date>" line for evergreen landing pages.
 *
 * Companion to the `dateModified` field in the page's WebPage JSON-LD: the
 * schema date is for machines, this one is a human trust signal and an E-E-A-T
 * input. Both read the SAME per-page constant, so they can never disagree —
 * a visible date that contradicts the structured one is worse than neither.
 *
 * The date is passed in, never derived from `new Date()`. A date that moves on
 * every build tells Google the whole site churns constantly and teaches it to
 * discount the signal sitewide. See generateWebPageSchema for the same rule.
 */
export default async function LastUpdated({
  date,
  className = "",
}: {
  /** ISO 8601 YYYY-MM-DD, from the page's CONTENT_UPDATED constant. */
  date: string;
  className?: string;
}) {
  const [t, locale] = await Promise.all([
    getTranslations("common"),
    getLocale(),
  ]);

  // Parse as UTC. `new Date("2026-08-21")` is already UTC-midnight, but a
  // local-time formatter can render the PREVIOUS day for viewers west of
  // Greenwich, so the timeZone is pinned rather than left to the runtime.
  const formatted = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

  return (
    <p
      className={`text-sm text-[var(--foreground-muted)] ${className}`.trim()}
    >
      <time dateTime={date}>{t("lastUpdated", { date: formatted })}</time>
    </p>
  );
}
