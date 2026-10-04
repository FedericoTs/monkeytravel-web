"use client";

import { useEffect } from "react";

/**
 * BuildHop's feedback widget for the launch listing
 * (https://buildhop.io/discover/monkeytravel-6a52cf38-01c1-4cb9-9420-4a901acb64f5).
 * It reads data-launch-id off document.currentScript, so it needs a real
 * <script src> carrying that attribute. Appended once the page has loaded and
 * the main thread is idle, so no page waits for buildhop.io before hydrating.
 */
const SRC = "https://buildhop.io/feedback-widget.js";
const BUILDHOP_LAUNCH_ID = "6a52cf38-01c1-4cb9-9420-4a901acb64f5";

export default function BuildHopFeedbackWidget() {
  useEffect(() => {
    // Not on phones: the launcher sat on page content and on the consent bar,
    // so it is neither shown there (app/globals.css) nor downloaded.
    if (window.matchMedia("(max-width: 639px)").matches) return;
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    const inject = () => {
      if (document.querySelector(`script[src="${SRC}"]`)) return;
      const script = document.createElement("script");
      script.src = SRC;
      script.async = true;
      script.setAttribute("data-launch-id", BUILDHOP_LAUNCH_ID);
      document.head.appendChild(script);
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(inject, { timeout: 4000 });
      } else {
        timeoutId = window.setTimeout(inject, 1000);
      }
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);
  return null;
}
