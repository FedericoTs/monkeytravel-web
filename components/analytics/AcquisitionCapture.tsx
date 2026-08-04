"use client";

import { useEffect } from "react";
import { useAnalyticsConsent } from "@/lib/consent/hooks";

/**
 * First-touch acquisition capture for ORGANIC traffic.
 *
 * Why this exists — measured 2026-08-04: `users.acquisition_source` was
 * populated for 0 of 370 users. It was not broken. middleware.ts already
 * captures `?utm_source=` into an `mt_utm_source` cookie and the auth callback
 * already stamps it onto the row at signup. That chain works — it just only
 * fires for UTM-TAGGED links (built for the Hostelworld partnership). Organic
 * Google, Reddit, direct and referral traffic carry no UTM, so the column was
 * structurally blind to ~100% of real acquisition and we could not answer
 * "where do users come from".
 *
 * This fills that gap by deriving a coarse channel from document.referrer and
 * writing it into the SAME cookie the callback already reads, so nothing
 * downstream changes.
 *
 * WHY CLIENT-SIDE AND NOT IN MIDDLEWARE. Middleware would be the natural home
 * and needs no extra component — but consent lives in localStorage
 * (CONSENT_STORAGE_KEY), which middleware cannot read. Extending the
 * middleware cookie to every visitor would therefore start tracking all EU
 * traffic with no way to honour a refusal, in a product whose consent model
 * defaults `analytics` to FALSE. Running here means the existing
 * `useAnalyticsConsent()` gate applies.
 *
 * The tradeoff, stated plainly: users who decline analytics are not
 * attributed, so channel mix will UNDER-count. Partial and consented beats
 * complete and not. Read the resulting numbers as "of consenting users".
 *
 * Deliberately coarse: a bucket name only. No full referrer URL, no query
 * string, no path, nothing that identifies a person.
 */

const SOURCE_COOKIE = "mt_utm_source";
const MEDIUM_COOKIE = "mt_utm_medium";
const MAX_AGE_S = 60 * 24 * 60 * 60; // 60d — matches middleware.ts

/** Map a referrer hostname to a coarse, non-identifying channel bucket. */
function bucketFor(hostname: string): { source: string; medium: string } {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  const is = (...names: string[]) =>
    names.some((n) => h === n || h.endsWith("." + n));

  if (is("google.com", "google.co.uk", "google.it", "google.es", "google.com.br"))
    return { source: "google", medium: "organic" };
  if (is("bing.com", "duckduckgo.com", "ecosia.org", "yahoo.com", "yandex.com"))
    return { source: h.split(".")[0], medium: "organic" };
  if (is("chatgpt.com", "openai.com", "perplexity.ai", "claude.ai", "gemini.google.com"))
    return { source: "ai_assistant", medium: "referral" };
  if (is("reddit.com")) return { source: "reddit", medium: "social" };
  if (is("instagram.com")) return { source: "instagram", medium: "social" };
  if (is("facebook.com", "fb.com")) return { source: "facebook", medium: "social" };
  if (is("tiktok.com")) return { source: "tiktok", medium: "social" };
  if (is("x.com", "twitter.com", "t.co")) return { source: "x", medium: "social" };
  if (is("pinterest.com")) return { source: "pinterest", medium: "social" };
  if (is("linkedin.com", "lnkd.in")) return { source: "linkedin", medium: "social" };
  if (is("youtube.com")) return { source: "youtube", medium: "social" };
  if (is("news.ycombinator.com")) return { source: "hackernews", medium: "social" };

  // Anything else: record that it was a referral without storing the host, so
  // one unusual referrer can never single a visitor out.
  return { source: "referral", medium: "referral" };
}

function hasCookie(name: string): boolean {
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith(name + "="));
}

export default function AcquisitionCapture() {
  const analyticsAllowed = useAnalyticsConsent();

  useEffect(() => {
    if (!analyticsAllowed) return;
    // First-touch wins, same rule as middleware. A UTM-tagged arrival has
    // already set this and must never be overwritten by a later organic hit —
    // partner attribution outranks a generic bucket.
    if (hasCookie(SOURCE_COOKIE)) return;

    let source: string;
    let medium: string;

    const ref = document.referrer;
    if (!ref) {
      source = "direct";
      medium = "none";
    } else {
      let host: string;
      try {
        host = new URL(ref).hostname;
      } catch {
        return; // unparseable referrer — record nothing rather than guess
      }
      // Internal navigation is not an acquisition event. Bail so the real
      // first touch (this same effect on the true landing page) is what lands.
      if (host === window.location.hostname) return;
      ({ source, medium } = bucketFor(host));
    }

    const attrs = `; max-age=${MAX_AGE_S}; path=/; samesite=lax${
      window.location.protocol === "https:" ? "; secure" : ""
    }`;
    document.cookie = `${SOURCE_COOKIE}=${source}${attrs}`;
    document.cookie = `${MEDIUM_COOKIE}=${medium}${attrs}`;
  }, [analyticsAllowed]);

  return null;
}
