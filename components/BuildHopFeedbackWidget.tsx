/**
 * BuildHop's feedback widget for the launch listing
 * (https://buildhop.io/discover/monkeytravel-6a52cf38-01c1-4cb9-9420-4a901acb64f5).
 *
 * WHY THIS IS A RAW <script> AND NOT next/script
 * The widget's first three statements are:
 *
 *     var script = document.currentScript;
 *     if (!script) { return; }
 *
 * ...and it reads its data-launch-id off that element. `document.currentScript`
 * is null for any script inserted programmatically — that is the spec, not a
 * bug in their code. next/script (every strategy) injects via
 * createElement + appendChild, so the widget loaded, ran, set its
 * window.__buildHopFeedbackWidgets registry, returned at line 7, and rendered
 * nothing. No console error, no failed request: it looks completely healthy
 * from the outside, which is exactly how it shipped broken.
 *
 * A raw tag is parsed from the document, so currentScript resolves. It stays a
 * server component (no "use client") — this is markup, not behaviour.
 *
 * The nonce is still required: script-src uses nonce + 'strict-dynamic', so an
 * un-nonced tag is refused regardless of the host allowlist.
 *
 * `async` matches BuildHop's own embed snippet. React 19 may hoist an async
 * script to <head>; that is fine — hoisted or not it is still parsed from the
 * document, which is the only property currentScript cares about.
 */

interface BuildHopFeedbackWidgetProps {
  /** Per-request CSP nonce, threaded from RootLayout via getNonce(). */
  nonce?: string;
}

const BUILDHOP_LAUNCH_ID = "6a52cf38-01c1-4cb9-9420-4a901acb64f5";

export default function BuildHopFeedbackWidget({ nonce }: BuildHopFeedbackWidgetProps) {
  return (
    <script
      async
      src="https://buildhop.io/feedback-widget.js"
      data-launch-id={BUILDHOP_LAUNCH_ID}
      nonce={nonce}
    />
  );
}
