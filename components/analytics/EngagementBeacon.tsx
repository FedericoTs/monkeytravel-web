"use client";

/**
 * Fires once per session, after a few seconds of VISIBLE time on any page.
 *
 * This is the signal that lets a session be counted as a visit rather than as
 * a request. `page_views.is_bot` is a user-agent regex, and the traffic that
 * doubled the wizard denominator on 2026-08-17 defeats it: 629 localized
 * step-1 sessions from CN/SG/HK sharing 29 rotating user agents, none flagged,
 * six sessions across three regions that ever had an account. The wizard could
 * already tell them apart because it has `step1_heartbeat`; everywhere else a
 * blog reader and a scraper produced identical rows.
 *
 * Why this discriminates without judging anyone by identity or geography:
 *
 *   - a PREFETCHED document never runs client effects, so it cannot fire;
 *   - a headless fetcher that renders and exits does not stay for the delay;
 *   - a background tab does not accrue time, because the timer only runs
 *     while the page is actually visible;
 *   - a person who reads anything at all trivially passes.
 *
 * It is fire-and-forget with `keepalive`, so a visitor who leaves the instant
 * the timer completes still gets counted, and every failure is swallowed —
 * this must never be visible to a visitor or to the page it sits in.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Visible milliseconds before a page load counts as a visit. */
const ENGAGED_AFTER_MS = 4000;
/** Once per session per tab; the server also dedupes per session. */
const SENT_KEY = "mt_engaged_sent";

export default function EngagementBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    // Already counted in this tab — the server keeps only the first row
    // anyway, so this just avoids the request.
    try {
      if (sessionStorage.getItem(SENT_KEY) === "1") return;
    } catch {
      // Storage blocked (private mode, "block all cookies"). Fall through and
      // let the server dedupe instead of dropping the signal entirely.
    }

    let visibleMs = 0;
    let last = Date.now();
    let done = false;
    let timer: number | undefined;

    const send = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        sessionStorage.setItem(SENT_KEY, "1");
      } catch {
        /* not fatal */
      }
      void fetch("/api/page-engaged", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, locale: document.documentElement.lang || undefined }),
        keepalive: true,
      }).catch(() => {});
    };

    const tick = () => {
      if (document.visibilityState === "visible") visibleMs += Date.now() - last;
      last = Date.now();
      if (visibleMs >= ENGAGED_AFTER_MS) send();
      else timer = window.setTimeout(tick, ENGAGED_AFTER_MS - visibleMs);
    };

    const onVisibility = () => {
      // Accrue what was visible before the switch, then restart the clock so
      // hidden time is never counted.
      if (document.visibilityState === "hidden") {
        visibleMs += Date.now() - last;
      }
      last = Date.now();
    };

    document.addEventListener("visibilitychange", onVisibility);
    timer = window.setTimeout(tick, ENGAGED_AFTER_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}
