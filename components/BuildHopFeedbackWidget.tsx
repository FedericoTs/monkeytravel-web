import Script from "next/script";

/**
 * BuildHop's feedback widget for the launch listing
 * (https://buildhop.io/discover/monkeytravel-6a52cf38-01c1-4cb9-9420-4a901acb64f5).
 *
 * The widget's first statements are `var script = document.currentScript;
 * if (!script) return;` and it reads its data-launch-id off that element, so
 * it must be parsed from the document: a tag inserted programmatically ran,
 * registered itself and rendered nothing. `beforeInteractive` is the one
 * next/script strategy that writes the tag into the initial HTML, and Next
 * stamps its CSP nonce on it where a page renders with one; prerendered pages
 * admit it by host instead.
 */
const BUILDHOP_LAUNCH_ID = "6a52cf38-01c1-4cb9-9420-4a901acb64f5";

export default function BuildHopFeedbackWidget() {
  return (
    <Script
      src="https://buildhop.io/feedback-widget.js"
      strategy="beforeInteractive"
      data-launch-id={BUILDHOP_LAUNCH_ID}
    />
  );
}
