# Operator Env-Var Checklist (Day-7 status)

Audited via `vercel env ls production` on 2026-05-31. The codebase
fully implements the features below but they degrade gracefully (or
no-op) until the operator-provisioned credentials are added.

## ✅ Operational

| Env Var | Used By | Notes |
|---------|---------|-------|
| `GOOGLE_AI_API_KEY` | lib/gemini.ts, lib/ai/packing-list.ts, lib/gemini-vision.ts | Gemini AI — operational. Match: code reads `GOOGLE_AI_API_KEY` (NOT `GEMINI_API_KEY`) so earlier "rotate GEMINI_API_KEY" flag refers to this. Rotate via Google AI Studio → API Keys. |
| `RESEND_API_KEY` | lib/email/client.ts | Email send pipeline operational. |
| `SEND_EMAIL_HOOK_SECRET` | Supabase Auth Send Email hook | Resend-branded auth emails working. |
| `RESEND_WEBHOOK_SECRET` | app/api/webhooks/resend/route.ts | Bounce/complaint tracking. |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role db clients | Admin paths working. |
| `CRON_SECRET` | All cron routes | Daily/weekly cron auth working. |
| Google Places/Maps/Cloud, Amadeus, Pexels, PostHog, Sentry, GA | various | All operational. |

## ❌ Missing — degrades silently

### `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (impact: P1)
**Why it matters**: `lib/api/rate-limit.ts` falls back to a per-lambda in-memory `Map` when these are absent. On Vercel, each function instance has its own map → rate limits don't span instances. Day-7 back-test showed inconsistent firing of `wizard-event-session` (60×204+5×429 some runs, 65×204+0×429 other runs) for exactly this reason. The same affects:
- `/api/wizard-event` IP + session limits
- `/api/places/autocomplete` shared cache (post-Day-7 API-opt migration)
- `/api/subscribe`, `/api/contact`, `/api/shared/[token]/vote`, etc.

**Action**: 
1. Sign up at https://upstash.com (free tier covers ~10k req/day)
2. Create a Redis database (any region — Vercel routes will use it via HTTPS)
3. Copy the REST URL + REST Token from the Upstash dashboard
4. `vercel env add UPSTASH_REDIS_REST_URL` (Production, Preview, Development)
5. `vercel env add UPSTASH_REDIS_REST_TOKEN` (same scopes)
6. Redeploy

### `RESEND_AUDIENCE_ID` (impact: P3 marketing prep)
**Why it matters**: `app/api/cron/sync-resend-audience/route.ts` runs weekly Mondays 06:00 UTC. Without this env var it soft-skips with `{skipped:true, reason:"RESEND_AUDIENCE_ID not set"}`. The bootstrap of 118 contacts was already done one-off via `scripts/export-all-users-to-resend.mts`; without the cron, new signups don't reach the audience.

**Action**:
1. Resend dashboard → Audiences → Create or pick existing audience
2. Copy the audience ID (uuid)
3. `vercel env add RESEND_AUDIENCE_ID` (Production)
4. Wait for next Monday cron OR `curl -H "Authorization: Bearer $CRON_SECRET" https://monkeytravel.app/api/cron/sync-resend-audience` to trigger manually

### `NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG` (impact: revenue gap)
**Why it matters**: `lib/affiliates/amazon.ts` falls back to `tag=TAG_TBD` in every Amazon CTA on packing-list items. Clicks open Amazon but commission goes nowhere.

**Action**:
1. Sign up at https://affiliate-program.amazon.com if not enrolled
2. Get your associate tag (e.g. `monkeytravel-20`)
3. `vercel env add NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG` (Production, Preview)
4. Redeploy

## ❌ Missing — feature blocked (P0)

### Apple Sign-In OAuth (impact: P0 — App Store Rule 4.8)
**Why it matters**: The codebase has Apple Sign-In UI wired (`/auth/login` + `/auth/signup`) but the Supabase Auth provider isn't enabled. Tapping the button currently 400s with raw JSON error. App Store Rule 4.8 requires Sign in with Apple as an option whenever third-party SSO is offered.

**Action** (operator-only — Supabase dashboard or Mgmt API):
1. Apple Developer → Certificates, Identifiers & Profiles → Create a Services ID for `app.monkeytravel.auth`
2. Configure Sign in with Apple under that Services ID — add `https://sevfbahwmlbdlnbhqwyi.supabase.co/auth/v1/callback` as Return URL
3. Apple Developer → Keys → Create a new Key with Sign in with Apple enabled. Download the .p8 private key.
4. Supabase Dashboard → Authentication → Providers → Apple → Enable
5. Paste: Service ID, Team ID, Key ID, and the contents of the .p8 file
6. Save

Once configured the existing `/auth/login` Apple button works without code changes.

---

This file should be moved/deleted once all four are configured.
