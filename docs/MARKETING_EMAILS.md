# Marketing Emails — Blog Digest & Announcements (Resend Broadcasts)

Branded, localized marketing emails (blog digest + single-post announce)
sent through **Resend Broadcasts**. Deliberately kept separate from the
transactional pipeline (`lib/email/send.ts`) and the auth hook.

## Why this is separate from transactional email

Marketing mail has a higher spam-complaint rate than transactional mail. If
a newsletter blast hurts the sending reputation of the address it's sent
from, it drags down inbox placement for **password resets and signup
confirmations** — the emails that must land.

**Rule: send marketing from a dedicated subdomain.**

1. In Resend → Domains, add a subdomain, e.g. `news.monkeytravel.app`
   (or `mail.`). Verify its SPF/DKIM (separate DNS records from the apex).
2. Use a From like `MonkeyTravel <hello@news.monkeytravel.app>` for
   broadcasts. The apex `monkeytravel.app` stays reserved for auth +
   transactional only.

## Consent — who you may email

- Default `users.notification_settings.marketingNotifications` is **false**
  at signup, so you may NOT bulk-email all users.
- Eligible audiences: users who explicitly set `marketingNotifications =
  true`, and `email_subscribers` (the landing-page waitlist — they opted in).
- Honor unsubscribes: Resend Broadcasts inject a one-click unsubscribe via
  the `{{{RESEND_UNSUBSCRIBE_URL}}}` token (already used by our render
  helper) and maintain the broadcast suppression list automatically.

## Templates

- `lib/email/templates/BlogDigest.tsx` — "recent / best posts" (image cards).
- `lib/email/templates/BlogAnnounce.tsx` — a single new post (hero).
- Both reuse the branded shell and are localized (en/es/it) via
  `lib/email/copy.ts` → `blogEmailCopy`.

## Workflow: compose & send a broadcast

1. **Build a Resend Audience** with the opted-in users + `email_subscribers`.
   Two ways:
   - **Scripted (REST API):** write the recipient list to
     `out/audience-contacts.json` (JSON array of `{email, firstName?, locale?}`
     — queried from Supabase: `email_subscribers` + users with
     `marketingNotifications = true`), then:
     ```bash
     RESEND_API_KEY=re_… npx tsx scripts/sync-resend-audience.mts            # dry-run
     RESEND_API_KEY=re_… npx tsx scripts/sync-resend-audience.mts --apply    # push
     ```
     Dry-run by default; `--apply` creates/updates the Audience + contacts.
   - **Manual:** CSV export → import in Resend → Audiences.

   > Note: this is NOT possible through the `resend` MCP server — that server
   > only exposes a single `send-email` tool, not Audiences/Contacts/Broadcasts.
   > Audience + broadcast operations use the Resend REST API (the scripts above).
2. **Render the HTML:**
   ```bash
   # Digest of the 3 NEWEST posts (English):
   npx tsx scripts/render-marketing-email.mts digest 3 en
   # Digest of the TOP 5 posts by PostHog pageviews (last 90 days):
   npx tsx scripts/render-marketing-email.mts digest top 5 en
   # Single-post announcement:
   npx tsx scripts/render-marketing-email.mts announce 3-day-paris-itinerary en
   ```
   Writes `out/marketing-<kind>-<locale>.html` with the unsubscribe token
   already embedded, and prints the **selected posts + subject** so you can
   confirm the list before sending.

   **Top-by-popularity** (`top`) ranks posts via PostHog pageviews
   (`lib/blog/popularity.ts`). It needs `POSTHOG_PERSONAL_API_KEY` +
   `POSTHOG_PROJECT_ID` (see `.env.example`). If those are unset or the query
   fails, it logs a warning and falls back to newest-first — so the command
   always produces output.
3. **Create the broadcast** in Resend → Broadcasts: pick the Audience, set
   From = your marketing subdomain, paste the rendered HTML, set the subject
   (printed by the render script), send or schedule.
   - For per-locale sends, segment the Audience by language and render once
     per locale (`… digest 3 es`, `… digest 3 it`).

> Tip: you can also drive steps 2–3 via the Resend Broadcasts API if you
> later want a one-command "send this week's digest" — but the dashboard is
> the simplest place to review before sending.

## Preview to your own inbox (no broadcast)

```bash
RESEND_API_KEY=re_… TEST_TO=you@example.com \
  ONLY=blog_digest,blog_announce npx tsx scripts/send-test-emails.mts
# Localized: add LOCALE=es or LOCALE=it
```
