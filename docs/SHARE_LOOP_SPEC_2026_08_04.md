# Share loop — spec, 2026-08-04

## Why

Measured in PostHog (all time, consenting users):

| Step | People | Rate |
|---|---|---|
| Saved a trip | 100 | — |
| Saw the share prompt | 82 | 82% |
| **Minted a share link** | **7** | **7%** |
| Opened a shared link | 20 | — |
| …someone other than the owner | 16 | 2.3 per link |
| …who then saved their **own** trip | 4 | 25% |

Implied k ≈ 0.07 × 2.3 × 0.25 ≈ **0.04**.

Everything below the mint already works. A link that exists reaches 2.3 people,
and a quarter of those people go on to create a trip — that is a healthy loop by
any standard. **The loop is not broken, it is unfired.** 93% of people who save a
trip never start it.

And they say they want to: `trip_intent_selected` shows **71% choose "with
friends"** over "just me", stable across all-time and last-30-days, on a 34%
answer rate (67 of 196 people who reached the wizard). The gap between 71%
stated group intent and 7% sharing is the entire opportunity.

Prompt outcomes, last 60d: 68 shown → **58 skip (85%)**, 9 invite, 1 publish.

## Diagnosis — three specific defects

**D1 — the ask lands before the user has seen the thing.**
`NewTripWizard.tsx:~1189` opens `ShareAfterSaveModal` on first insert, inside the
auto-save effect. The user has just been handed an itinerary they have not read
and is immediately asked to send it to their friends. Nothing has earned the ask.

**D2 — the copy ignores what the user already told us.**
Every user gets the same generic prompt, even though 71% ticked "with friends" on
step 1 and we now persist that as `trip_meta.trip_intent` (commit cfd995f).
"Share your trip" is a favour to us. "See what your crew thinks" is a favour to
them, and we know exactly who to say it to.

**D3 — clicking "Invite" does not create anything.**
`onInvite` does `router.push('/trips/{id}?share=invite')` — it navigates the user
to another page and asks them to act again. The link is not minted until they do
something else on trip detail. This is why 9 people clicked invite in 60 days but
only 7 have ever minted a link, all time. The click is intent; we drop it.

## Changes

### C1 — move the ask onto the trip, after engagement
**Files:** `app/[locale]/trips/new/NewTripWizard.tsx`, `components/trip/TripDetailClient.tsx`

- Remove the post-save trigger from the wizard (both `setShowShareAfterSaveModal(true)`
  sites, ~1189 and ~2162). Keep the modal component.
- Fire on `/trips/[id]` instead, for the trip **owner** only, when **all** hold:
  - the trip has no share link yet, and
  - the user has engaged — first of: scrolled past day 1, expanded any day, or
    25s dwell, and
  - not dismissed for this trip before.
- Persist dismissal per trip (`localStorage`, key `share_prompt_dismissed:{tripId}`),
  not per session. A user who says no once should not be asked again on that trip.

**Acceptance:** saving a trip shows no modal. Opening the saved trip and scrolling
shows it once. Reloading after dismissal shows nothing.

### C2 — branch the copy on `trip_meta.trip_intent`
**File:** `components/trip/ShareAfterSaveModal.tsx` (new `tripIntent` prop)

| intent | headline | primary CTA |
|---|---|---|
| `group` | "Your crew hasn't seen this yet" | **Get their votes** |
| `solo` | "Keep this handy" | **Copy link** |
| absent | "Send it to whoever's coming" | **Copy link** |

Only the `group` variant leads with voting. Do not show the voting pitch to
someone who said they are travelling alone — that is the mistake we are fixing,
in reverse.

New i18n keys under `wizard.sharePrompt.*` in **all four** locales
(`messages/{en,es,it,pt}/trips.json`). No hardcoded English — see task #321.

### C3 — mint the link on click, in place
**Files:** `components/trip/ShareAfterSaveModal.tsx`, `app/api/trips/[id]/share/route.ts`

`onInvite` must **not** navigate. On click:
1. `POST /api/trips/{id}/share` immediately → returns the token/URL.
2. Render the URL in the modal with a **Copy** button, pre-selected.
3. On mobile, call `navigator.share({ url, title })` when available — the native
   sheet is the single biggest lever on whether a link actually gets sent, and
   this is a phone-first flow.
4. Keep "Manage collaborators →" as a secondary link to `/trips/{id}?share=invite`
   for anyone who wants the full modal.

Failure: keep the modal open, show an inline retry. Never navigate away on error —
that is how intent gets lost today.

**Acceptance:** one click on "Get their votes" produces a copyable URL without a
page transition, and `crew_link_created` fires on that click.

### C4 — fix the instrumentation
**File:** `lib/posthog/events.ts` and call sites

- `trip_shared` is **declared but never called anywhere**. Either wire it at the
  real share moment or delete it — right now it makes share tracking look present
  when it is absent.
- Add `share_prompt_variant_shown { intent }` so C2's branches are comparable.
- Add `share_link_copied { method: 'copy' | 'native_share' }` — the current data
  cannot distinguish "minted a link" from "actually sent it".
- Add `share_modal_opened { source: 'prompt' | 'trip_detail' }`. 81 people reached
  trip detail in 60d and what they did with the share button is invisible.

## Success criteria

Primary: **mint rate 7% → ≥20%** of savers within 3 weeks of ship.
Secondary: k from ≈0.04 to ≈0.12 (≈ +5 signups/week at current volume).
Guardrail: no drop in `first_trip_saved`; the prompt must not interfere with save.

Read with:
```sql
select trip_meta->>'trip_intent' as intent, count(*)
from trips where created_at > '2026-08-04' group by 1;
```
plus `crew_link_created / (trip_created)` per week in PostHog.

## Out of scope

- The swipe/"would you go?" voting mechanic itself. `/shared/[token]` already has
  anonymous voting (task #13); this spec only fixes *getting people there*.
- Referral incentives. `referred_by_code` is 0/370 and bananas have no external
  value — a separate, weaker bet.
- Anything on acquisition. This raises the value of each existing user; it does
  not fix the ~35 signups/week plateau.

## Risks

- **Small samples.** 16 non-owner recipients and 4 conversions — the 2.3 and 25%
  figures have wide error bars. Treat them as encouraging, not precise.
- **Consent-gated data.** PostHog only sees consenting users; absolute rates
  undercount. Ratios within PostHog are sound.
- **The 71% is stated intent, not behaviour.** It is the best signal available and
  it is consistent across windows, but it is still what people say.
- **Moving the prompt off the wizard could lower impressions.** Some users never
  return to the trip. Watch `share_prompt_shown` volume: if it falls more than
  ~30%, the engagement gate is too strict — loosen the dwell before abandoning C1.

---

## Implementation status — 2026-08-04, all shipped

| | Change | Commit | Notes |
|---|---|---|---|
| C1 | Ask moved onto the trip, engagement-gated | `0fea966` | Shipped, gate narrower than specced — see below |
| C2 | Copy branches on `trip_intent` | `7dafcb1` | Shipped, different i18n location |
| C3 | Mint on click, in place | `7dafcb1` | Shipped |
| C4 | Instrumentation | `7dafcb1` + `0fea966` | Shipped, one acceptance line was unbuildable |

Both production deploys are `READY`.

### Where the implementation diverges from this spec

Recorded because a spec that no longer matches the code is worse than no spec.

**C1 — the engagement gate is two triggers, not three.** Specced: "scrolled past
day 1, expanded any day, or 25s dwell". Built: `window.scrollY > 600` **or** 25s
dwell. There is no expand-a-day trigger; day expansion does not currently emit
anything `SharePromptOnTrip` can observe, and adding a callback into the day
components to feed a prompt would have coupled them to it. Scroll depth is a
proxy for the same thing. If prompt volume disappoints, this is the first knob.

**C1 — file paths.** The spec names `components/trip/TripDetailClient.tsx`; the
real path is `app/[locale]/trips/[id]/TripDetailClient.tsx`, and the logic lives
in a new `components/trip/SharePromptOnTrip.tsx` rather than inside that 3,000-line
component.

**C2 — the i18n keys are not where this spec says.** Specced
`wizard.sharePrompt.*` in `messages/{locale}/trips.json`. Built: `share.intent.*`
plus seven `share.afterSave.*` keys in `common.json`, because the modal already
read its other copy from `common.json` and splitting one component's strings
across two namespaces is how keys go missing in a later locale sweep. The third
branch is keyed `unknown`, not `absent`.

**C3 — the acceptance line named an event that does not exist.** It reads
"`crew_link_created` fires on that click". There is no such event in the codebase
and there never was. The mint is recorded as `share_prompt_action { action:
'invite' }`, which already existed; the *send* is the new `share_link_copied`.
The behavioural half of that acceptance — one click produces a copyable URL with
no page transition — is met.

**C4 — `trip_shared` was deleted, not wired.** The spec offered both. It had zero
call sites, and a never-fired export makes share tracking look present when it is
absent.

### Regression introduced and fixed in the same session

Moving the ask off the save moment left the **publish-to-explore opt-out tick
unreachable**: the wizard's modal is never opened any more, and nothing passed
`onPublish` on the new surface. Caught before it could be measured, fixed in
`72ba507` — the publish call now lives inside `SharePromptOnTrip`, gated
server-side on `isExploreUgcEnabled() && isOwnerView && !isPublic`.

The `!isPublic` term is new and was not in this spec: the wizard could not know
it (a just-created trip is private by definition), but on the trip page offering
to publish an already-public trip is a dead affordance.

### Not verified live

Every gate on the new prompt requires an authed owner on a saved, unshared trip,
so none of C1–C4 has been exercised end-to-end against production. It is verified
by construction: tsc, eslint, 198 unit tests, and the existing share route's own
contract. The first real signal will be event volume, not a manual test.

### What to read first, in order

1. `share_prompt_shown` **volume** vs the pre-`0fea966` baseline. The guardrail
   above still stands: a fall of more than ~30% means the gate is too strict, and
   the dwell should be loosened before concluding C1 was wrong.
2. `share_prompt_variant_shown` split by `intent` — does the group branch convert
   better than solo, or was 71% stated intent that does not predict behaviour?
3. `share_link_copied` over mints. This is the number that was invisible before.
4. Mint rate against the 7% → ≥20% target.
