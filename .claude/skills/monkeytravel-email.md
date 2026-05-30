---
name: monkeytravel-email
description: |
  Compose, preview, localize, and send MonkeyTravel emails — transactional
  (auth confirmation, password reset, magic link), collaboration
  notifications (trip invite, vote feedback, trip reminders), and MARKETING
  (blog-post announcements + "top/recent posts" digests via Resend
  Broadcasts). Use this skill whenever the user wants to: send or schedule a
  newsletter, announce a new blog post by email, send a digest of top/recent
  posts, preview any email template, change email copy, or understand/operate
  the email system. ALWAYS confirms the copy, the exact blog posts, the
  audience, the locale(s), and the subject with the user BEFORE anything is
  sent.
---

# MonkeyTravel Email — operate & send

This skill is the single source of truth for sending email from MonkeyTravel.

## 🔒 GOLDEN RULE — confirm before ANY send (non-negotiable)

**Never send, broadcast, schedule, or trigger any email — not even a test or
preview to the user's own inbox — without the user's explicit confirmation in
chat first.** This includes running `scripts/send-test-emails.mts`, calling
the Resend API, creating/sending a Resend Broadcast, or any equivalent.

Before any send, present a **send plan** and get an explicit "yes" (use the
AskUserQuestion tool). The plan MUST state every one of these:

1. **What** — which template(s) (e.g. blog digest, post announcement).
2. **Audience** — who receives it and roughly how many (test inbox? a Resend
   Audience? which segment?). For broadcasts, name the Audience.
3. **From / subdomain** — the exact From address (marketing must use the
   dedicated subdomain, see below).
4. **Locale(s)** — en / es / it, and whether you're sending one per language.
5. **Subject line(s)** — verbatim, per locale.
6. **Blog posts** — for digests/announcements, the **exact list**: each
   post's title + slug, and the ordering source ("top by PostHog pageviews"
   vs "newest"). Never let the post selection be implicit.
7. **Copy** — offer to render and show the copy (or send a preview to the
   user's OWN inbox) so they can read it before the real audience does.

If the user changes any item, re-render and re-confirm. Only proceed on a
clear affirmative. If anything is ambiguous, ask — do not assume.

> Why this matters: marketing sends are irreversible and outward-facing, and a
> wrong post list / bad copy / wrong audience can't be recalled. Confirmation
> is the whole point of this skill.

## The three email lanes

| Lane | Templates | How it sends | Confirmation |
|---|---|---|---|
| **Transactional / auth** | ConfirmSignup, AuthAction (reset / magic link / email change) | Supabase "Send Email" hook → Resend (`app/api/auth/send-email/route.ts`) | System-driven by user actions (signup etc.) — you don't manually send these. |
| **Notifications** | Invite, VoteCast, TripReminder | `lib/email/send.ts` → Resend, triggered by app events / the reminder cron | App/cron-driven. You don't manually blast these. |
| **Marketing** | BlogDigest, BlogAnnounce | **Resend Broadcasts** (you render HTML, send from the dashboard/API) | **This is what the GOLDEN RULE governs.** |

All copy is localized (en/es/it) in `lib/email/copy.ts`. The shared shell is
`lib/email/templates/_layout.tsx`. Deep docs:
`docs/AUTH_EMAIL_HOOK.md` and `docs/MARKETING_EMAILS.md`.

## One-time setup (verify before the first marketing send)

1. **Marketing subdomain** verified in Resend (e.g. `news.monkeytravel.app`).
   Marketing MUST send from it (e.g. `MonkeyTravel <hello@news.monkeytravel.app>`)
   so newsletter complaints can't sink auth/transactional deliverability on
   the apex domain.
2. **Resend Audience** built from opted-in contacts only: users with
   `notification_settings.marketingNotifications = true` + the
   `email_subscribers` waitlist. Default consent is OFF — never bulk-email
   everyone. Sync it with `scripts/sync-resend-audience.mts` (query the
   opted-in list from Supabase → write `out/audience-contacts.json` → run the
   script; dry-run by default, `--apply` to push). NOTE: the `resend` MCP
   server canNOT do this — it only exposes `send-email`; Audiences/Broadcasts
   are REST-API only.
3. For **top-by-popularity** digests: `POSTHOG_PERSONAL_API_KEY` +
   `POSTHOG_PROJECT_ID` set (see `.env.example`). Without them the digest
   silently falls back to newest-first.

## Workflows

### A. Announce a new blog post
1. Confirm the post (slug), locale(s), subject, audience with the user.
2. Render: `npx tsx scripts/render-marketing-email.mts announce <slug> <locale>`
   → writes `out/marketing-announce-<locale>.html`, prints subject + the post.
3. **Re-confirm** the printed subject + post + (offer a preview to the user's
   inbox). Then the user creates the Resend Broadcast (Audience, From =
   marketing subdomain, paste HTML, subject) and sends/schedules.

### B. Top / recent posts digest
1. Decide ordering WITH the user:
   - `digest top <count> <locale>` → ranked by PostHog pageviews (last 90d).
   - `digest <count> <locale>` → newest-first.
2. Render: `npx tsx scripts/render-marketing-email.mts digest top 5 en`
   (or without `top`). The script PRINTS the selected posts (title + slug) and
   the ordering — **show this list to the user and get confirmation that these
   are the right posts** before any send.
3. Render per locale if sending localized (`… top 5 es`, `… top 5 it`).
4. User sends via Resend Broadcast (per-language segment if localized).

### C. Preview to your own inbox (still requires confirmation)
`RESEND_API_KEY=re_… TEST_TO=<addr> ONLY=blog_digest,blog_announce LOCALE=es npx tsx scripts/send-test-emails.mts`
Confirm the recipient + templates first. This DOES send (to the test address).

## Key files & commands

- Render marketing HTML (no send): `scripts/render-marketing-email.mts`
- Preview-send any template: `scripts/send-test-emails.mts`
  (`ONLY=` filter, `LOCALE=` for es/it, `TEST_TO=`, throttled to 5 req/s)
- Popularity ranking: `lib/blog/popularity.ts` (PostHog HogQL, graceful fallback)
- Copy / translations: `lib/email/copy.ts` (edit here to change wording — then
  re-render and re-confirm before sending)
- Check delivery: `GET https://api.resend.com/emails/{id}` → `last_event`
  (delivered / opened / bounced / suppressed)

## Deliverability & consent guardrails

- Resend free tier = 5 requests/second (the preview script throttles 300ms).
- A hard-bounced address is auto-**suppressed** by Resend; further sends
  return an id but show `last_event: suppressed` and never arrive. Verify the
  recipient is real before testing.
- Every broadcast must include the unsubscribe token
  `{{{RESEND_UNSUBSCRIBE_URL}}}` — the render script embeds it automatically.
- Only email opted-in audiences. Honor `marketingNotifications`.
