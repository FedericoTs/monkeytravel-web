"use client";

import { useEffect, useRef } from "react";
import { trackContentViewed, setContentGroup } from "@/lib/analytics";
import { captureContentViewed } from "@/lib/posthog/events";
import posthog from "posthog-js";

interface ContentTrackerProps {
  contentType: string;
  contentId: string;
  contentGroup: string;
  metadata?: Record<string, unknown>;
}

/**
 * ContentTracker — fires semantic content-view events on mount.
 *
 * Drop into any server-rendered page to enrich both GA4 and PostHog with
 * content_type, content_id, content_group, and arbitrary metadata (slug,
 * category, reading_time, continent, etc.).
 *
 * Fires once per mount via useRef guard. Safe if PostHog/GA4 aren't loaded.
 */
export default function ContentTracker({
  contentType,
  contentId,
  contentGroup,
  metadata,
}: ContentTrackerProps) {
  const hasFired = useRef(false);

  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;

    const params = {
      content_type: contentType,
      content_id: contentId,
      content_group: contentGroup,
      ...metadata,
    };

    // GA4: set content group dimension + fire content_viewed
    setContentGroup(contentGroup);
    trackContentViewed(params);

    // PostHog: fire content_viewed if loaded
    if (typeof posthog?.capture === "function") {
      captureContentViewed(params);
    }
  }, [contentType, contentId, contentGroup, metadata]);

  return null;
}
