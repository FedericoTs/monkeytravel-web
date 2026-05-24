# Email Service Hand-off — Resend Activation

## TL;DR

The code is in production and self-skips cleanly when `RESEND_API_KEY` is
unset. To turn email on:

1. Sign up at https://resend.com (free tier: 100 emails/day, 3k/month)
2. Verify `monkeytravel.app` as a sending domain (3 DNS records)
3. Add 4 env vars to Vercel:
   - `RESEND_API_KEY=re_...`
   - `EMAIL_FROM="MonkeyTravel <noreply@monkeytravel.app>"`
   - `EMAIL_REPLY_TO=hello@monkeytravel.app`
   - `EMAIL_UNSUBSCRIBE_SECRET=` (random 32-byte hex — optional for now)
4. Apply the migration `20260524_email_log_and_invite_email.sql` (still
   pending alongside `20260523_notifications_scaffold.sql`)
5. Redeploy. The next invite send + the next vote on someone's trip will
   actually email.

No code changes needed.

## What's already wired

| Surface | Behavior today (no API key) | Behavior with key |
|---|---|---|
| `POST /api/trips/[id]/invites` with `recipientEmail` | Creates invite row, logs `email_log` as `skipped_no_key` | Sends invite email, logs `sent` + provider message_id |
| `enqueueNotification({type: "collab_vote", ...})` | Inserts `notifications` row, attempts email dispatch (skipped) | Sends vote-cast email to trip owner |
| Bell UI in navbar | Unchanged (Realtime push) | Unchanged |
| `notifications` + `email_log` tables | Need migration applied | Need migration applied |

## What you do, step by step

### Step 1 — Resend signup + sending domain (30 min mostly waiting)

1. https://resend.com → sign up (free tier 100/day / 3k/mo, paid $20/mo
   for 50k/mo; you only pay if you outgrow free)
2. Add Domain → `monkeytravel.app`
3. Resend shows 3 DNS records:
   - SPF (`TXT @ "v=spf1 include:_spf.resend.com ~all"`)
   - DKIM (one `CNAME` like `resend._domainkey ...`)
   - DMARC (optional but strongly recommended:
     `TXT _dmarc "v=DMARC1; p=none; rua=mailto:dmarc@monkeytravel.app"`)
4. Add the records at your DNS provider (Vercel DNS, Cloudflare, whichever)
5. Click "Verify" in Resend — takes 5-30 min to propagate
6. Once verified, generate an API key: Settings → API Keys → Create
   - Permission: "Sending access"

### Step 2 — Vercel env vars

```
RESEND_API_KEY=re_abc123...
EMAIL_FROM=MonkeyTravel <noreply@monkeytravel.app>
EMAIL_REPLY_TO=hello@monkeytravel.app
```

Set these on the Production environment in Vercel. (You can set them on
Preview too if you want PR previews to send to your test address.)

### Step 3 — Apply both pending migrations

Two migrations are stacked waiting:

1. `supabase/migrations/20260523_notifications_scaffold.sql` (the in-app
   notifications table — bell UI depends on it)
2. `supabase/migrations/20260524_email_log_and_invite_email.sql` (this
   feature)

In the Supabase dashboard → SQL Editor:

1. Open each file from the repo, paste the contents into a new query,
   click Run
2. Both are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
   EXISTS`, `DROP POLICY IF EXISTS`) so re-running is safe

OR, if MCP is reconnected to the Trawell project, ask Claude to apply
them via the Supabase MCP tools.

### Step 4 — Smoke test

After deploying with the env vars set:

1. In the app, share a trip via email to your test address
2. Check `email_log` for the row:
   ```sql
   SELECT recipient_email, template_id, status, sent_at, message_id
   FROM email_log
   ORDER BY created_at DESC
   LIMIT 5;
   ```
3. Should show `status='sent'` with a `message_id`
4. Check your inbox — should arrive within ~30 seconds
5. Check Resend dashboard → Emails → confirm it shipped

### Step 5 — Inbox placement check

Send one invite to a Gmail address, one to an Outlook address, one to an
Apple iCloud address (or use https://mail-tester.com — free, gives you a
score out of 10). Target ≥9/10. If it lands in spam, the most common
fixes:

- DMARC missing or set to `p=reject` too aggressively
- SPF record lists too many `include:` directives (the 10-lookup limit)
- `From:` address doesn't match the verified domain
- HTML-only emails (we already include a text fallback — that's why
  templates have both `default export` and `emailText()` helpers)

## What's deferred to a follow-up session

The full plan in `.audit/implementation-plans.md` §3 is 14 steps / 10
dev-days. This scaffold ships steps 2, 3, 4 (partial), 5, 7 (partial).
The remaining items:

| Step | What | Why deferred |
|---|---|---|
| 4 (rest) | CommentAdded + WeeklyDigest templates | Comment feature not shipped yet; digest needs cron |
| 6 | Email tab in ShareAndInviteModal | UI work — separable; current API is callable from any frontend |
| 8 | Vercel cron for batched digest sends | Needs preference UI + opt-in toggle first |
| 9 | (bell UI already shipped in notifications scaffold) | — |
| 10 | Preference center at `/profile/notifications` | Bigger UI lift — separable |
| 11 | One-click unsubscribe with HMAC tokens | Defer until first marketing send (none yet) |
| 12 | ES + IT translations of templates | Defer until EN deliverability is proven |
| 13 | Resend webhook handler for bounces/complaints | Needs Resend webhook signing secret |
| 14 | Deliverability QA via mail-tester | Manual step after first send |

When you want any of these, ask Claude to pick up where this left off.

## Code map

```
lib/email/
├── client.ts              ← Resend wrapper (no-ops without API key)
├── send.ts                ← Orchestrator: opt-out + suppression + log + send
└── templates/
    ├── _layout.tsx        ← Brand header/footer wrapper
    ├── Invite.tsx         ← "X invited you to plan Y" + plain-text helper
    └── VoteCast.tsx       ← "Y loved/voted-no on Z" + plain-text helper

supabase/migrations/
├── 20260523_notifications_scaffold.sql   ← Bell UI table (still pending)
└── 20260524_email_log_and_invite_email.sql ← This feature

app/api/trips/[id]/invites/route.ts       ← Now accepts recipientEmail
lib/notifications/service.ts              ← enqueueNotification → email dispatch
```

## Things that will trip you up

1. **Resend refuses sends from unverified domains.** Until DNS is verified,
   100% of sends fail with a clear error. The send helper logs the
   failure to `email_log.error` so you can see what went wrong.

2. **Free tier rate limits.** 100 emails/day, 3k/month. If you hit them
   you'll see `429` rejections in `email_log.error`. Upgrade if usage
   warrants.

3. **The recipient may not be a registered MonkeyTravel user.** That's
   fine for invites — the invite acceptance flow handles signup. For
   `vote_cast` etc, the recipient is always the trip owner so they
   exist. But the code never assumes a user exists for the recipient
   email (no foreign key on `email_log.recipient_email`).

4. **Suppression list lives in `email_log`.** When the bounce webhook is
   wired (step 13), it'll INSERT a `bounced` row. The orchestrator
   checks for any prior `bounced` / `complained` row before sending and
   skips with `skipped_suppressed`. To unsuppress: delete those rows
   (after verifying with the recipient that the address is now valid).

5. **Email_log RLS** lets a user read their OWN email history (matched
   on `auth.users.email`). They can't see anyone else's. INSERT/UPDATE
   are service-role only.
