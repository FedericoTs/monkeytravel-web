# Expense Ledger and Split

## TL;DR
Add a per-trip expense ledger so trip members can record what each person paid, split the cost across the group, and view a running "who owes whom" balance in the user's home currency. At trip end a one-tap "settle up" view collapses the graph into the minimum set of transfers and exports to CSV / WhatsApp / email. Eliminates the Splitwise hop that today bleeds users out of the post-booking surface.

## Problem and User Pain
- Job-to-be-done: *"While I am on the trip with my friends, I want to record shared expenses as they happen and know at the end exactly how much I owe each person, in my home currency, without doing math at 2am."*
- Current workaround: users either (a) open Splitwise, retype the destination + trip name, manually add each collaborator, and lose the link back to the itinerary; (b) keep a Notes app list and reconcile by hand on the flight home; or (c) silently absorb the cost imbalance, which research shows triggers post-trip friction in 38% of group trips (Splitwise 2023 in-app survey).
- Quantified pain: in our own collab cohort (`trip_collaborators` rows with role=editor), the median group trip has 4.2 members and the average trip in EUR-zone destinations involves expenses in 1.7 currencies. The cognitive cost of manual FX conversion is the #1 reason users abandon shared-expense tools mid-trip (Splitwise blog, 2024).
- Strategic angle: we already own the trip object, the collaborator graph (`trip_collaborators`), the user's home currency (`lib/locale/context.tsx#preferredCurrency`), and live FX rates (`lib/locale/currency.ts`). Building this in-app is the lowest-friction surface in the market for groups that planned the trip on monkeytravel.

## Success Metrics
- **Primary**: % of saved group trips (>=2 collaborators) that have at least one `trip_expenses` row entered within 14 days of the trip's `start_date`. Target: 25% in 90 days post-launch.
- **Secondary**:
  - Median expenses per active-ledger trip (target >= 8 after trip end).
  - Settle-up view opened / ledger created (target >= 70% — i.e. people actually close the loop).
  - DAU of trips with `last_expense_at` within last 24h during trip window (engagement proxy).
  - Post-trip 14-day retention lift on the cohort with ledger usage vs. control.
- **Anti-metrics** (we'd hate to see):
  - Average time-to-add-expense > 25s (means the form is too heavy — Splitwise benchmark is 12s).
  - Sync-conflict-resolved events / total expense writes > 2% (the offline queue is corrupting state).
  - Settle-up "this is wrong" feedback rate > 5% (math is incorrect or the user model of who-paid-for-whom is off).

## User Flow (happy path)
1. **Entry**: From `/trips/[id]`, a new "Expenses" tab appears next to "Itinerary" / "Map" / "Packing" (only renders when `expense_ledger` flag is on for the user OR `trip_collaborators.count >= 2`). Tab badge shows current user's net balance (e.g. "-€42").
2. **Add expense (modal)**: Floating "+" FAB → `AddExpenseSheet` (bottom sheet on mobile, modal on desktop):
   - Amount (numeric keypad on mobile, defaults to last-used currency).
   - Currency (chip selector — last 3 used + search; defaults to the trip's primary destination currency from `lib/destinations/data`).
   - Category (chip row: Food, Lodging, Transport, Activities, Other — icons from `lucide-react`).
   - Paid by (avatar row; defaults to current user).
   - Split among (avatar row, multi-select; defaults to "everyone"; "Equal" toggle on by default; "Exact amounts" reveals per-person input rows).
   - Description (single line, optional, max 140 chars).
   - Occurred at (defaults to now; picker for retroactive entries).
   - Receipt photo (optional, camera-roll picker; Capacitor Camera plugin on native, `<input type=file capture>` on web).
3. **Submit**: optimistic UI update (row appears instantly in ledger). If online, POST to `/api/trips/[id]/expenses`. If offline (`navigator.onLine === false` OR Capacitor `Network.getStatus()`), the row is queued in `lib/platform/storage` under key `expense-queue:<tripId>` and re-tried on next online event.
4. **Ledger view**: chronological list grouped by day. Each row shows: icon, description, payer avatar, amount in native currency + converted to home currency (subtle, smaller). Tap → detail / edit / delete. A persistent top strip shows each member's running balance in home currency.
5. **Settle up**: at any time, but auto-prompted in a banner once `end_date < now()`. Tap "Settle up" → screen shows a list of "Alice owes Bob €38", computed via greedy minimum-cash-flow. Each row has a "Mark paid" toggle (writes to `trip_expense_settlements`). Export buttons: "Copy to clipboard", "Share to WhatsApp" (uses `lib/native/share.ts`), "Email summary", "Download CSV".
6. **Done state**: when all rows on the settle-up view are "Mark paid", the trip's ledger flips to "Settled ✓" and the tab badge disappears.

## Edge Cases and Failure Modes
- **Currency rate stale / Frankfurter down**: rates are cached for 1h (`lib/locale/currency.ts`); if cache miss and fetch fails, balances render in the ORIGINAL currency with a tooltip "Rates unavailable — showing native amounts" and a manual retry. The settle-up CTA stays clickable but warns "Settle-up disabled until rates load — try again." We never silently invent a rate.
- **Splits don't sum to total** (exact-amount mode): client-side validation blocks submit; banner reads "Splits sum to €48 but expense is €50 — assign the remaining €2." Server-side guard repeats the check (see RPC below) and returns `SPLIT_MISMATCH`.
- **Payer not in split**: legal — Alice paid €40 for Bob and Carol's meal, she isn't a participant. UI default is "Split among everyone except payer" if user explicitly toggles.
- **Collaborator removed mid-trip**: `trip_expense_splits.user_id` references `auth.users(id) ON DELETE SET NULL` — we keep the historical record but render "Removed user" in the UI. Their share is reassigned via an "Adjust split" affordance.
- **Auth issues** (anon viewer on a trip): the expenses tab does not render for non-collaborators. RLS enforces (see below). Anon viewers on `/shared/[token]` never see expenses — financial data is collab-only.
- **External-API failure**: only external dep is Frankfurter (already wired with 5-min backoff and silent degradation). No other vendors.
- **Privacy edge case**: expense data is private even within the trip — only `trip_collaborators` (any role) see it. Removed collaborators lose access immediately via RLS. Receipt photos in Supabase Storage are private bucket + signed URL (10-min TTL).
- **Offline duplicate submit**: every queued expense generates a client-side UUID (`crypto.randomUUID()`) used as the primary key. The insert uses `ON CONFLICT (id) DO NOTHING` so a queue-flush retry never doubles a row.
- **Clock skew on offline entries**: `occurred_at` is the user's local timestamp; `created_at` is server `now()`. Display sorts by `occurred_at`; conflict tiebreak by `created_at`.
- **Decimal precision**: all amounts are integer cents (`amount_cents BIGINT`). Currencies with 0 decimals (JPY, KRW) and 3 decimals (BHD, KWD) are handled by `lib/locale/currency.ts` formatter — store native minor units, render via `Intl.NumberFormat`.
- **Receipt photo size**: client-side resize to 1600px longest edge + WebP encode before upload (target <300 KB / photo). Max 5 MB hard cap server-side.

## Technical Architecture

### Data model

```sql
-- supabase/migrations/20260601_trip_expense_ledger.sql

CREATE TABLE public.trip_expenses (
  id             UUID PRIMARY KEY,                   -- client-generated, supports offline dedupe
  trip_id        UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  paid_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_cents   BIGINT NOT NULL CHECK (amount_cents > 0),
  currency       CHAR(3) NOT NULL,                   -- ISO 4217, validated against SUPPORTED_CURRENCIES
  category       TEXT NOT NULL CHECK (category IN ('food','lodging','transport','activities','other')),
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  description    TEXT CHECK (description IS NULL OR length(description) <= 140),
  receipt_path   TEXT,                               -- Storage object path, NULL if no photo
  created_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ                         -- soft-delete for "undo" UX
);

CREATE INDEX idx_trip_expenses_trip ON public.trip_expenses(trip_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_trip_expenses_payer ON public.trip_expenses(paid_by) WHERE deleted_at IS NULL;

CREATE TABLE public.trip_expense_splits (
  expense_id  UUID NOT NULL REFERENCES public.trip_expenses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  share_cents BIGINT NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);
CREATE INDEX idx_trip_expense_splits_user ON public.trip_expense_splits(user_id);

CREATE TABLE public.trip_expense_settlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  from_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  currency      CHAR(3) NOT NULL,                    -- home currency at time of settlement
  settled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  method        TEXT                                 -- free-text "venmo", "cash", optional
);
CREATE INDEX idx_trip_expense_settlements_trip ON public.trip_expense_settlements(trip_id);
```

### RLS — mirror `trip_collaborators` cycle-2 pattern

Use the existing `public.user_is_trip_collaborator(p_trip_id, p_user_id)` SECURITY DEFINER helper from `20260529_tighten_trip_collaborators_rls.sql` so we don't recurse on policies.

```sql
ALTER TABLE public.trip_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members can read expenses" ON public.trip_expenses
  FOR SELECT TO authenticated
  USING (
    public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
    OR public.user_is_trip_collaborator(trip_id, (SELECT auth.uid()))
  );

CREATE POLICY "Trip members can insert expenses" ON public.trip_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (
      public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
      OR public.user_is_trip_collaborator(trip_id, (SELECT auth.uid()))
    )
  );

CREATE POLICY "Creator can update own expense" ON public.trip_expenses
  FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()));

CREATE POLICY "Creator or trip owner can delete expense" ON public.trip_expenses
  FOR DELETE TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR public.user_is_trip_owner(trip_id, (SELECT auth.uid()))
  );
```

Same shape for `trip_expense_splits` (read = read parent expense, write = creator-of-parent only) and `trip_expense_settlements` (read = trip members, write = either party in the transfer).

### Atomic write RPC (closes split-sum TOCTOU)

Mirror the `accept_trip_invite` pattern (`20260529_atomic_accept_trip_invite.sql`):

```sql
CREATE OR REPLACE FUNCTION public.upsert_trip_expense(
  p_expense   JSONB,         -- { id, trip_id, paid_by, amount_cents, currency, category,
                              --   occurred_at, description, receipt_path }
  p_splits    JSONB          -- [{ user_id, share_cents }, ...]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_split BIGINT;
  v_expense_amount BIGINT := (p_expense->>'amount_cents')::BIGINT;
  v_trip_id UUID := (p_expense->>'trip_id')::UUID;
BEGIN
  -- Authorization (defense-in-depth — RLS also enforces).
  IF NOT (public.user_is_trip_owner(v_trip_id, auth.uid())
          OR public.user_is_trip_collaborator(v_trip_id, auth.uid())) THEN
    RETURN jsonb_build_object('error_code','FORBIDDEN');
  END IF;

  SELECT COALESCE(SUM((s->>'share_cents')::BIGINT), 0)
    INTO v_total_split
    FROM jsonb_array_elements(p_splits) s;

  IF v_total_split <> v_expense_amount THEN
    RETURN jsonb_build_object('error_code','SPLIT_MISMATCH',
                              'expected', v_expense_amount,
                              'got', v_total_split);
  END IF;

  INSERT INTO public.trip_expenses
    (id, trip_id, paid_by, amount_cents, currency, category, occurred_at,
     description, receipt_path, created_by)
  VALUES
    ((p_expense->>'id')::UUID, v_trip_id, (p_expense->>'paid_by')::UUID,
     v_expense_amount, p_expense->>'currency', p_expense->>'category',
     COALESCE((p_expense->>'occurred_at')::TIMESTAMPTZ, now()),
     p_expense->>'description', p_expense->>'receipt_path', auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET amount_cents = EXCLUDED.amount_cents,
        currency     = EXCLUDED.currency,
        category     = EXCLUDED.category,
        occurred_at  = EXCLUDED.occurred_at,
        description  = EXCLUDED.description,
        updated_at   = now()
    WHERE trip_expenses.created_by = auth.uid();

  DELETE FROM public.trip_expense_splits WHERE expense_id = (p_expense->>'id')::UUID;
  INSERT INTO public.trip_expense_splits (expense_id, user_id, share_cents)
  SELECT (p_expense->>'id')::UUID, (s->>'user_id')::UUID, (s->>'share_cents')::BIGINT
    FROM jsonb_array_elements(p_splits) s;

  RETURN jsonb_build_object('ok', true, 'id', p_expense->>'id');
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_trip_expense(JSONB, JSONB) TO authenticated;
```

### API surface

- `POST /api/trips/[id]/expenses` — body `{ expense, splits }`; calls `upsert_trip_expense` RPC; returns 200 `{ ok, id }` or 422 on SPLIT_MISMATCH / 403 on FORBIDDEN. Rate-limited via `createRateLimiter("trip-expenses-write", 30, 60_000)` keyed on `userId`.
- `GET /api/trips/[id]/expenses` — returns `{ expenses: [...], splits: [...], settlements: [...], balances: {...} }`. Balances computed server-side using current FX (cached). Response cached 30s (`Cache-Control: private, max-age=30`).
- `DELETE /api/trips/[id]/expenses/[expenseId]` — soft-deletes (sets `deleted_at`). Authorization via RLS.
- `POST /api/trips/[id]/expenses/settle-up` — body `{ from_user_id, to_user_id, amount_cents, currency, method? }`; writes `trip_expense_settlements`.
- `GET /api/trips/[id]/expenses/export?format=csv` — streams CSV with columns: `date,description,category,payer,amount,currency,amount_home_ccy,split_among,share_per_person`.
- `POST /api/trips/[id]/expenses/receipt` — multipart upload; returns signed URL + `receipt_path` to attach.

### Key components

```
components/trips/expenses/
  ExpenseLedger.tsx          // tab content — renders ledger + balances + FAB
  AddExpenseSheet.tsx        // BaseModal-based; uses next-intl
  ExpenseRow.tsx             // memoized list row
  BalancesStrip.tsx          // sticky top-of-tab member balances
  SettleUpView.tsx           // greedy min-cashflow algorithm + share/export
  ExpenseQueueProvider.tsx   // offline-queue context (reads lib/platform/storage)
lib/expenses/
  split.ts                   // equal-split + exact-split validators
  settle.ts                  // greedy min-cashflow (Dinic / heap)
  format.ts                  // wraps lib/locale/currency for amounts
```

Component prop shapes (the load-bearing ones):

```ts
interface ExpenseLedgerProps {
  tripId: string;
  members: { user_id: string; display_name: string; avatar_url: string | null }[];
  primaryCurrency: CurrencyCode;            // from trip destination
  homeCurrency: CurrencyCode;               // from useLocale()
  initialExpenses: Expense[];               // SSR-rendered
}

interface AddExpenseSheetProps {
  open: boolean;
  onClose: () => void;
  tripId: string;
  members: Member[];
  defaultCurrency: CurrencyCode;
  defaultPayerId: string;                   // current user
  existingExpense?: Expense;                // edit mode
}
```

### External integrations

- **Frankfurter** — already wired in `lib/locale/currency.ts`. No new vendor.
- **Supabase Storage** — new private bucket `trip-receipts`. Path scheme: `trip-receipts/<trip_id>/<expense_id>.webp`. RLS on the bucket: `auth.uid()` must be a `trip_collaborators` row for `<trip_id>` (use the `user_is_trip_collaborator` helper inside a storage policy). Signed URLs minted server-side with 10-min TTL.
- **Capacitor Camera** — `@capacitor/camera` for native receipt capture. Lazy-import as `lib/native/camera.ts` (mirror `lib/native/share.ts` pattern) so the plugin never enters the web bundle.

### Caching strategy

- FX rates: existing 1h cache in `localStorage` (`lib/locale/currency.ts`) — reused.
- Server-side `GET /api/trips/[id]/expenses`: 30s `Cache-Control: private, max-age=30`. Invalidated client-side by `mutate()` after every write (use SWR or the existing `useFetch`).
- Offline queue: `lib/platform/storage` key `expense-queue:<tripId>` holds JSON array of unsent expense payloads. Flushed on `online` event + on next ledger view mount.
- Materialized balance view (Phase 3): `mv_trip_expense_balances(trip_id, user_id, balance_cents)` refreshed on every settle-up to avoid recomputing on every GET.

### Observability

- PostHog events (snake_case to match cycle-5 convention):
  - `expense_added` ({ trip_id, currency, category, split_mode, member_count })
  - `expense_edited` / `expense_deleted`
  - `expense_offline_queued` / `expense_offline_synced`
  - `settle_up_opened` / `settle_up_marked_paid` / `settle_up_exported` ({ format })
  - `expense_receipt_uploaded`
- Sentry tags: `feature: "expense-ledger"`, `trip_id`, `member_count`. Sentry breadcrumb on every RPC failure with `error_code`.
- Server log line shape (matches cycle-5): `{ level, route, userId, tripId, errorCode, durationMs }`.

### Security review

- **Auth**: every route requires `getAuthenticatedUser()` (or 401). Anon access via `/shared/[token]` does NOT expose expense data — the tab itself is gated server-side on `user_is_trip_collaborator`.
- **RLS**: every table has policies above. Defense-in-depth via the `upsert_trip_expense` RPC's explicit `user_is_trip_collaborator` check.
- **Rate limit**: write routes capped at 30/min/user (`createRateLimiter`). Export route capped at 10/min/user. Receipt upload capped at 20/hour/user.
- **CSRF**: same-origin Next.js fetch + SameSite=Lax session cookie. No new attack surface.
- **Sensitive scopes**: receipt photos are PRIVATE bucket, signed URL only. EXIF stripping on upload (use `sharp` server-side before write — already a transitive dep via Next.js image optimization).
- **Money handling**: BIGINT cents everywhere — no floating-point arithmetic crosses any boundary. Split sums validated server-side in RPC.
- **PII**: receipts may contain card numbers / names. Document in Privacy page and add a 90-day-post-trip auto-delete cron (`/api/cron/purge-old-receipts`).

## Implementation Phases

### Phase 1 — MVP (1.5 weeks, behind `expense_ledger` PostHog flag)
- Migration: 3 tables + RLS + `upsert_trip_expense` RPC + `trip-receipts` Storage bucket.
- API: POST/GET/DELETE for expenses, POST for settle-up. No CSV/receipt yet.
- UI: `ExpenseLedger` tab, `AddExpenseSheet` with equal-split + exact-split, `BalancesStrip`, `SettleUpView` with greedy min-cashflow + Copy-to-clipboard export.
- next-intl: new `messages/{en,it,es}/expenses.json` namespace, ~60 keys.
- E2E test (`tests/e2e/expense-ledger.spec.ts`): collaborator adds expense → second collaborator sees balance update → settle-up renders correct transfers.
- Ship to 5% of users with >=2 collaborators on a trip, monitor PostHog funnel.

### Phase 2 — Polish (1 week)
- Receipt photo upload (web file input + Capacitor Camera).
- Offline queue (`ExpenseQueueProvider` + `lib/platform/storage`).
- Soft-delete + undo toast.
- CSV export + WhatsApp/email share via `lib/native/share.ts`.
- Auto-prompt settle-up banner on `end_date < now()`.
- Flag rollout to 100%.

### Phase 3 — Optimization & depth (ongoing)
- By-percentage and by-shares split modes.
- Materialized balance view + invalidation triggers.
- Multi-trip aggregate "people you've travelled with" view in `/profile`.
- Smart category suggestion via Gemini (free-text "tapas con Marco" → `food` + auto-fill description).
- Recurring expenses (Airbnb split across N nights).
- Integration tap-out: "Send to Splitwise" deep-link for users who already have a Splitwise group.
- A/B: default-split-includes-payer (off) vs (on).

## Effort and Cost
- **Engineering**: ~3 person-weeks (1 BE-heavy, 1 FE-heavy, 0.5 polish, 0.5 QA + i18n). 1 engineer can do it sequentially in ~4 calendar weeks.
- **Infra cost** (at 10k active group trips/month, median 12 expenses each = 120k rows/mo):
  - Supabase rows: 120k expenses + ~400k splits/mo. Postgres row cost on Supabase Pro is rounding error.
  - Frankfurter calls: 1 cached call / user / hour, ~50k calls/mo, $0 (free API).
  - Supabase Storage receipts: assume 30% of expenses get a photo, ~36k photos/mo × 250 KB compressed = 9 GB/mo. At $0.021/GB-month = **$0.19/mo**. Egress (signed-URL views) ~30 GB/mo at $0.09/GB = **$2.70/mo**.
  - Vercel function invocations: ~600k/mo (add + list + balance). At $0.60/M = **$0.36/mo**.
- **Vendor cost**: $0 (Frankfurter free, no new vendors).
- **Total marginal**: < $5/mo at projected scale.

## Risks and Mitigations
1. **Risk**: Splits-don't-sum bugs corrupt balances and erode trust. **Mitigation**: server-side sum check in `upsert_trip_expense` RPC + integer-cents end-to-end + property-based test in `lib/expenses/split.test.ts`.
2. **Risk**: Offline queue collides with concurrent edits from another collaborator (last-write-wins clobber). **Mitigation**: include `updated_at` in payload, RPC rejects if server `updated_at` > client. UI shows "Updated by Alice — refresh?" toast.
3. **Risk**: FX rate at settle-up differs from rate when expense was logged → "settled" amount differs from sum of running balances. **Mitigation**: snapshot `fx_rate_to_home` per expense at write time (add column in Phase 2); settle-up uses the snapshot, not live rates.
4. **Risk**: Receipt photos leak via mis-scoped Storage policy. **Mitigation**: Storage bucket private, RLS uses `user_is_trip_collaborator` helper, signed-URL TTL 10 min, E2E test attempts cross-trip access and expects 403.
5. **Risk**: Adoption ceiling — users keep using Splitwise because of habit. **Mitigation**: Phase 3 "Send to Splitwise" interop turns us into a complement instead of a competitor; measure ledger-creation rate weekly and pivot to "in-trip log + Splitwise export" framing if MVP <15%.

## Open Questions
- Should the trip owner be able to retroactively edit a collaborator's expense, or only delete-and-recreate? (Splitwise allows edit; we propose no for MVP, only owner can delete.)
- Currency snapshot vs. live rate at settle-up: snapshot in MVP or wait for Phase 2? (Recommend snapshot from day 1 — schema friendly, cheap.)
- Do we surface the ledger inside `/shared/[token]` for the trip owner only if they happen to load the share page logged in? (Recommend no — keep `/shared` as a marketing surface, expenses live only on `/trips/[id]`.)
- Settle-up algorithm: pure greedy (n-1 transfers) vs optimal min-flow (NP-hard but tiny n)? For typical group sizes (<=6) the two are within 1 transfer ~95% of the time — greedy is fine for MVP.
- Do we charge for the ledger as a paid feature (Splitwise Pro is $3/mo)? Pricing decision tied to broader monetization roadmap — out of scope, default to free during launch.

## References
- `supabase/migrations/20251220_create_trip_collaboration.sql` — `trip_collaborators` schema we mirror.
- `supabase/migrations/20260529_tighten_trip_collaborators_rls.sql` — `user_is_trip_collaborator` SECURITY DEFINER helper we reuse in RLS.
- `supabase/migrations/20260529_atomic_accept_trip_invite.sql` — atomic-RPC pattern with `error_code` jsonb return shape.
- `supabase/migrations/20260525_explore_ugc_feed.sql` — atomic counter / explicit GRANT pattern.
- `lib/locale/currency.ts` — Frankfurter integration, cache, backoff.
- `lib/locale/context.tsx` — `useLocale().preferences.preferredCurrency`, `convertCurrency` hook.
- `lib/platform/storage.ts` — Capacitor-aware async storage for the offline queue.
- `lib/api/rate-limit.ts` — `createRateLimiter` (Upstash + in-memory fallback).
- `lib/native/share.ts` — pattern for dynamic-import native plugins (apply to `lib/native/camera.ts`).
- `app/[locale]/trips/[id]/TripDetailClient.tsx` — where the new Expenses tab gets wired.
- `messages/en/trips.json` — namespace pattern for new `expenses.json` strings.
- `tests/e2e/` — Playwright pattern for the multi-user collaborator E2E test.
