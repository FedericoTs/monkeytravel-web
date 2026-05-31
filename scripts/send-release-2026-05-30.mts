/**
 * Send the 2026-05-30 release email to a curated recipient list.
 *
 * v2: now uses the shared branded EmailLayout (logo, rainbow stripe,
 * branded card, footer) via lib/email/templates/ReleaseAnnouncement.tsx
 * — visually consistent with the auth + invite emails.
 *
 * Each recipient gets their locale (inferred from browsing pattern;
 * auth.users.user_metadata.locale not set on these accounts).
 *
 * Usage:
 *   $env:RESEND_API_KEY = "re_..."
 *   npx tsx scripts/send-release-2026-05-30.mts                # dry run + preview
 *   npx tsx scripts/send-release-2026-05-30.mts --send         # real send
 *   npx tsx scripts/send-release-2026-05-30.mts --preview-only # write previews to .audit/email-previews/
 */

import { Resend } from "resend";
import { render } from "@react-email/render";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as ReleaseMod from "../lib/email/templates/ReleaseAnnouncement";
import type { EmailLocale } from "../lib/email/copy";

// tsx + ESM interop wraps the module twice: ReleaseMod.default is the
// actual module object, and .default on THAT is the React component.
// Mirrors the pattern in scripts/send-test-emails.mts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Release = (ReleaseMod as any).default ?? ReleaseMod;
const ReleaseEmail = Release.default ?? Release;
const releaseEmailSubject = Release.releaseEmailSubject;
const releaseEmailText = Release.releaseEmailText;

const apiKey = process.env.RESEND_API_KEY;
const DRY_RUN = !process.argv.includes("--send");
const PREVIEW_ONLY = process.argv.includes("--preview-only");

if (!apiKey && !PREVIEW_ONLY) {
  console.error("✗ RESEND_API_KEY required (or use --preview-only).");
  process.exit(1);
}

const FROM = "MonkeyTravel <hello@monkeytravel.app>";
const REPLY_TO = "hello@monkeytravel.app";

interface Recipient {
  email: string;
  name: string;
  locale: EmailLocale;
}

const RECIPIENTS: Recipient[] = [
  { email: "azzolina.francesca@gmail.com", name: "Francesca", locale: "it" },
  { email: "federicosciuca@gmail.com", name: "Federico", locale: "en" },
  { email: "marinoenrico3@gmail.com", name: "Enrico", locale: "en" },
];

// ----------------------------------------------------------------------------
// Render previews + optionally save to disk for human review
// ----------------------------------------------------------------------------

interface Prepared {
  to: string;
  name: string;
  locale: EmailLocale;
  subject: string;
  html: string;
  text: string;
}

const prepared: Prepared[] = [];
for (const r of RECIPIENTS) {
  const element = ReleaseEmail({ name: r.name, locale: r.locale });
  const html = await render(element);
  const text = releaseEmailText({ name: r.name, locale: r.locale });
  const subject = releaseEmailSubject(r.locale);
  prepared.push({ to: r.email, name: r.name, locale: r.locale, subject, html, text });
}

// Always save previews so they can be reviewed before/after sending
const PREVIEW_DIR = join(import.meta.dirname, "..", ".audit", "email-previews", "2026-05-30");
mkdirSync(PREVIEW_DIR, { recursive: true });
for (const p of prepared) {
  const fname = `${p.locale}-${p.name.toLowerCase()}.html`;
  writeFileSync(join(PREVIEW_DIR, fname), p.html);
}
console.log(`→ Previews saved to ${PREVIEW_DIR}`);

if (PREVIEW_ONLY) {
  console.log("\n✓ Preview-only mode — open the .html files above to inspect.");
  process.exit(0);
}

console.log(`\n${DRY_RUN ? "[DRY RUN]" : "[LIVE SEND]"} Release email — ${prepared.length} recipients\n`);

const resend = new Resend(apiKey!);

for (const p of prepared) {
  console.log(`→ ${p.to}  (${p.locale.toUpperCase()})`);
  console.log(`   subject: ${p.subject}`);
  console.log(`   html: ${p.html.length} bytes`);

  if (DRY_RUN) {
    console.log(`   [skipped — dry run]\n`);
    continue;
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: p.to,
      replyTo: REPLY_TO,
      subject: p.subject,
      html: p.html,
      text: p.text,
      tags: [
        { name: "category", value: "release-announcement" },
        { name: "campaign", value: "2026-05-30-v2" },
        { name: "locale", value: p.locale },
      ],
    });
    if (result.error) {
      console.log(`   ✗ FAILED: ${result.error.message}\n`);
    } else {
      console.log(`   ✓ sent — id: ${result.data?.id}\n`);
    }
  } catch (err) {
    console.log(`   ✗ EXCEPTION: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

console.log(
  DRY_RUN
    ? "\nDry run complete. Re-run with --send to actually deliver."
    : "\nAll sends attempted."
);
