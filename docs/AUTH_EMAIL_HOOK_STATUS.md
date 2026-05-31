# Auth email hook — verification report (2026-05-30)

## TL;DR

**Code: ✅ correct and tested. Hook: ❌ not actually firing in production yet.**

The branded Resend email pipeline is fully built. The Supabase auth hook
that's supposed to route every auth email (signup confirmation, password
reset, magic link, email change, reauthentication, invite) through it
**isn't enabled on the hosted Supabase project**. Real-user signups are
currently getting Supabase's default unbranded emails.

---

## What was verified

| Item | Status | How |
|---|---|---|
| Vercel `SEND_EMAIL_HOOK_SECRET` set | ✅ | `vercel env ls production` |
| Vercel `RESEND_API_KEY` set | ✅ | Same |
| Vercel `RESEND_WEBHOOK_SECRET` set | ✅ | Same |
| Vercel `NEXT_PUBLIC_SUPABASE_URL` set | ✅ | Same |
| `app/api/auth/send-email/route.ts` exists + verifies Svix signature + handles all 6 action types | ✅ | Read |
| `supabase/config.toml` declares `[auth.hook.send_email]` enabled | ✅ | Read |
| Resend sender domain `monkeytravel.app` verified (DNS) | ✅ | Resend API returns sends with `from: MonkeyTravel <noreply@monkeytravel.app>` |
| Test emails delivered + opened | ✅ | 20 `[TEST]` sends in last 24h via `scripts/send-test-emails.mts` all show `last_event: opened` |
| Branded ConfirmSignup React Email template | ✅ | Read `lib/email/templates/ConfirmSignup.tsx` — uses brand colours + i18n copy |

## What's NOT working

| Item | Status | Evidence |
|---|---|---|
| Production auth emails routed through Resend | ❌ | Resend API: 0 non-`[TEST]` auth sends in last 7 days. Yet `auth.users` has 14 new signups all confirmed in last 7 days. They got their emails — just not from us. |
| `email_log` populated | ⚠️ | Empty table — but expected: the auth hook calls `sendEmail()` directly, bypassing the orchestrator that writes to `email_log`. Not necessarily a bug. |

---

## Root cause (most likely)

`supabase config push` was never run with `SEND_EMAIL_HOOK_SECRET` in scope,
so the hook in `config.toml` line 44-47 never got applied to hosted Supabase.

The hosted project is still using Supabase's built-in email sender.

## Why we can't just `supabase config push` from here

`config.toml` declares only `[auth.email]`, `[auth.mfa]`, and
`[auth.hook.send_email]`. The CLI does **full-section replace, not partial
patch** (you flagged this earlier). Anything currently set on hosted but
NOT declared in `config.toml` — Google OAuth provider, redirect URLs,
site_url, password requirements — would get reset to CLI defaults on push.

**Pushing without first auditing the full hosted config = high risk of
breaking Google sign-in mid-flight.**

---

## Fix path — manual Dashboard enable (safest)

1. Open https://supabase.com/dashboard/project/sevfbahwmlbdlnbhqwyi/auth/hooks
2. Click **Add a new hook** → **Send Email Hook**
3. Configure:
   - **Hook type:** HTTPS
   - **URL:** `https://monkeytravel.app/api/auth/send-email`
   - **Secret:** copy the value of `SEND_EMAIL_HOOK_SECRET` from
     https://vercel.com/federicosciuca-gmailcoms-projects/travel-app-web/settings/environment-variables
     (it starts with `v1,whsec_...`)
4. Click **Save**
5. Verify the new hook appears in the list with status **Enabled**

## Then test

1. Open an incognito window
2. Sign up at https://monkeytravel.app/auth/signup with a real email you
   control (different from your normal account)
3. Within ~30 seconds, an email should arrive:
   - From: `MonkeyTravel <noreply@monkeytravel.app>`
   - Subject: `Confirm your email — MonkeyTravel` (or localised equivalent)
   - Branded HTML with the coral/teal palette + logo
   - "Confirm email" button
4. Click the button → land on `/trips` (signed in)
5. Verify in Resend dashboard: a new send WITHOUT the `[TEST]` prefix
   appears at https://resend.com/emails

## If the test fails

- Check Vercel function logs: `vercel inspect --logs https://monkeytravel.app | grep send-email`
- Most common cause: signature mismatch — the secret on the Dashboard
  must EXACTLY match `SEND_EMAIL_HOOK_SECRET` in Vercel env (no trailing
  newline, full `v1,whsec_...` prefix included)
- Second cause: Vercel function timing out — Supabase has a tight timeout
  on the hook; if our function is cold-starting >5s, Supabase falls back
  to default email
