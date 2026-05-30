# Branded Auth Emails — Supabase "Send Email" Hook

Signup confirmation, password reset, magic link, and email-change emails are
rendered from our own React Email templates and sent via Resend, instead of
Supabase's built-in generic emails. This is wired through a Supabase **Send
Email** auth hook.

## How it works

```
User signs up / resets password
        │
        ▼
Supabase Auth generates the token, then (hook enabled) POSTs the email
data to  https://monkeytravel.app/api/auth/send-email  (Standard Webhooks
signed with SEND_EMAIL_HOOK_SECRET)
        │
        ▼
app/api/auth/send-email/route.ts
  • verifies the signature (lib/email/verify-hook.ts)
  • builds the Supabase verify link (same semantics as the default email)
  • renders the branded template by action type:
      signup        → lib/email/templates/ConfirmSignup.tsx
      recovery      → lib/email/templates/AuthAction.tsx (kind=recovery)
      magiclink     → AuthAction (kind=magiclink)
      email_change  → AuthAction (kind=email_change)
      reauth/invite → AuthAction
  • sends via Resend (lib/email/client.ts)
```

Because the hook intercepts **all** auth emails, every action type is
handled (with a neutral fallback) so no auth flow is ever left without an
email.

## Activation (one-time, requires dashboard + deploy)

1. **Deploy** this code to production so `/api/auth/send-email` exists.
2. **Supabase Dashboard → Authentication → Hooks → Send Email**
   - Enable the hook.
   - HTTP URI: `https://monkeytravel.app/api/auth/send-email`
   - Copy the generated secret (looks like `v1,whsec_…`).
3. **Vercel → Project → Settings → Environment Variables (Production)**
   - Add `SEND_EMAIL_HOOK_SECRET` = the secret from step 2.
   - Redeploy so the new env var is live.
4. **Test**: sign up with a throwaway address (or use the resend-confirmation
   button) and confirm the branded email arrives and the link logs you in.

> Order matters: the endpoint must be deployed before you set the hook URL,
> and the secret must be in Vercel before the hook fires (the route fails
> closed — returns 500 — if `SEND_EMAIL_HOOK_SECRET` is unset).

## Previewing templates without a deploy

```bash
RESEND_API_KEY=re_... TEST_TO=you@example.com \
  npx tsx scripts/send-test-emails.mts
# Filter to specific templates:
ONLY=confirm_signup,auth_recovery npx tsx scripts/send-test-emails.mts
```

## Localization (implemented)

Auth emails are sent in the user's website language (en / es / it):

- The UI locale is stamped into auth `user_metadata.locale` at signup
  (`app/[locale]/auth/signup/page.tsx`) and into `users.preferred_language`
  in both the email-signup and OAuth paths (signup page + `auth/callback`).
- The hook reads `user_metadata.locale` (available in the webhook payload
  even before the `users` row commits) and renders the matching copy from
  `lib/email/copy.ts`. Falls back to English for older accounts with no
  stamped locale.
- Preview a locale: `LOCALE=es npx tsx scripts/send-test-emails.mts`.

### Notification emails are localized too

`lib/email/send.ts` resolves the recipient's language and passes it into the
template + shared shell (`_layout.tsx`):

- Order of precedence: explicit `options.locale` → `users.preferred_language`
  (folded into the existing opt-out lookup, no extra query) → English.
- The trip-reminder cron passes the locale it already resolved; the vote
  notification resolves it from `preferred_language`; invites default to the
  **inviter's** language (`user_metadata.locale`), since the recipient may
  have no account yet.
