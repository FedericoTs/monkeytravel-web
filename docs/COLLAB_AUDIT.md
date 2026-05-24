# Collaboration UX Audit — 2026-05-24

**Scope:** Code-level read of every collaboration entry point (~3.1k lines across
24 components + 5 API directories + 2 public-facing pages) + live test on
monkeytravel.app of the anonymous-facing surfaces.

**Verdict:** the *foundation* is genuinely strong (3-role permission model with
clear permission cards, well-designed RoleSelector, anonymous voting works,
onboarding modal exists). The *attrition leaks* are concentrated in three
places: (a) the homepage→wizard→result→share flow doesn't carry collaboration
intent forward, (b) the invite-recipient experience has a critical bug we
just shipped + 2 high-leverage fixes available, (c) shared trip viewers
have no "save my opinion" hook beyond voting.

---

## Findings — sorted by severity

### 🔴 P0 — Bugs / data loss in shipped code

| # | Finding | Evidence | Fix |
|---|---|---|---|
| **B1** | **Personal `message` from invite-by-email is silently dropped on the accept page.** Sender types "Hey! Wanna plan Tokyo together?" — recipient never sees it. We added `recipient_email` + `recipient_locale` + `message` to `trip_invites` last commit; the message is stored but `InviteAcceptClient.tsx` doesn't render it anywhere. | `app/[locale]/invite/[token]/InviteAcceptClient.tsx` (442 lines, no reference to `invite.message`). API route loads it from `trip_invites` per `app/api/invites/[token]/route.ts` but never returns it to the client. | Plumb `message` through `/api/invites/[token]` GET response → render it inside the same `messageBox` styling we built for the email template. **30 min.** |
| **B2** | **Duplicated brand in `<title>` on invalid invite page.** Live: title reads `"Invalid Invite \| MonkeyTravel \| MonkeyTravel"`. | Screenshot of `/invite/this-token-does-not-exist`. Metadata template likely double-appends ` \| MonkeyTravel`. | Either the layout adds the suffix already (so the page metadata shouldn't), or the page should pass `title.absolute`. **5 min.** |
| **B3** | **Inconsistent 404 design between `/invite/{invalid}` and `/shared/{invalid}`.** Invite uses a custom branded "Invalid Invite Link" + "Create Your Own Trip" CTA. Shared uses the generic 404 monkey page. Different visual languages for the same failure mode confuses users + signals inconsistent care. | Two screenshots of the same conceptual error → completely different layouts. | Standardise — either both use the friendly invite-style page (recommended; more context), or both use the generic 404. **1 hr.** |

### 🟠 P1 — Significant attrition leaks

| # | Finding | Evidence | Fix |
|---|---|---|---|
| **L1** | **Homepage promises collaboration; wizard doesn't deliver on it.** Hero copy: *"Plan Trips With Friends in 30 Seconds"*. CTA: *"Plan a Trip Together"*. Wizard step 1: no mention of collaboration anywhere. User generates a solo trip, only discovers the share button after they save. By then they've decided what the trip is — too late for the collaborators to influence the destination, dates, or vibes (the things friends most want input on). | Live screenshot of `/trips/new` step 1 — pure solo flow. Homepage screenshot — explicit "Together" framing. | Add an "Invite friends to vote" toggle at wizard step 1 (or step 2). If toggled, after generation, default the share modal to the invite tab. Track in PostHog: how many users discover share *before* vs *after* save. **2 hr.** |
| **L2** | **`/trips/{uuid}/edit` URL with no auth = generic "Welcome back" login wall with zero context.** Imagine a collaborator who got an invite a week ago, lost the email, clicks the trip link from their browser history → "Welcome back. Sign in to continue planning your trips." No mention of the trip name, the inviter, or what they're being invited to. Just a wall. | Live: `https://monkeytravel.app/trips/00000000-0000-0000-0000-000000000000/edit` → screenshot of bare login form. Network log shows only a Sentry call — no `/api/trips/[id]` attempt to fetch context. | When the redirect-to-login carries a `?redirect=/trips/[uuid]/...`, the login page should fetch `/api/trips/[id]/public-meta` (new endpoint, returns trip title + cover image + owner avatar with NO RLS) and show *"Sign in to join [Trip Title] by [Owner]"*. **3 hr.** |
| **L3** | **No "preview the trip" intermediate step on `/invite/[token]`.** Current page shows trip title, destination, dates, duration, collaborator count — but NO activities. A recipient thinking "do I even want to join this trip?" has to sign up to find out what's in it. | `app/[locale]/invite/[token]/InviteAcceptClient.tsx:240-272` — trip metadata only. | Show a 3-activity preview (first activity per day, lightweight) above the auth section. Builds trust + lowers the "what am I committing to?" cost. **3 hr.** |
| **L4** | **CollaboratorOnboarding only fires for non-owners.** `if (isOwner) return;` on line 27. The trip owner — the person who most needs to understand the collaboration features so they share the trip in the first place — gets zero onboarding. They have to figure out role/share/invite themselves. | `components/collaboration/CollaboratorOnboarding.tsx:27`. | Add an owner-flavored variant that fires once on a first-saved-trip → emphasises sharing + invite tabs. Mirror the 4-step pattern. **2 hr.** |
| **L5** | **No real-time presence on shared / collaborator trips.** Figma, Notion, Google Docs all show "X is here right now" avatars — turns collab from async messaging into a shared moment. We have Realtime infrastructure (used for the proposals hook + notifications bell) but don't surface presence. `CollaboratorAvatars` is purely static — shows who's a member, not who's online. | `components/collaboration/CollaboratorAvatars.tsx` — no Supabase Realtime subscription. | Add a `presence` channel via Supabase Realtime, glow the avatar of online users (small green dot + animate). **1-2 days.** |

### 🟡 P2 — Friction worth addressing

| # | Finding | Evidence | Fix |
|---|---|---|---|
| **F1** | **4-option voting model is rich but high-cognitive.** Love / Flexible / Concerns / No — and Concerns/No force a comment modal before submitting. The forced-comment is great for constructive feedback but the 4 options dilute the signal vs thumbs-up/thumbs-down. Most users probably skip "Flexible" → it's basically a fancy "I don't care." | `components/collaboration/VoteButtons.tsx:74` — `["love", "flexible", "concerns", "no"]`. The simpler `AnonymousActivityVoteBar.tsx` on shared trips already collapses to up/down. | Two options: (a) keep 4 in proposals (where nuance matters) but use thumbs-up/down on activities (where simplicity wins), (b) collapse "flexible" → make it a tap-twice-to-confirm on "love." A/B test which actually drives more votes. **No code change without data; recommend instrumentation first.** |
| **F2** | **No "what changed since you last looked" affordance.** Collaborator opens the trip a week later — was anything voted on? Did the owner change Day 3? Currently they have to read everything. Engagement decays. | No "last_viewed_at" tracking per collaborator that I found. | Add `trip_collaborators.last_viewed_at` (already exists as `last_seen_at` per the schema in audit doc — verify). Surface a "🟢 3 new activities, 2 new votes since you last looked" banner at top of trip. **1 day.** |
| **F3** | **Proposals workflow is overkill for 2-person trips.** When a couple is planning Tokyo, "suggest activity → wait for vote → owner approves → activity added" is a frustrating dance. Compare: just adding the activity directly. | `useProposals.ts` + `ProposalSection.tsx` always run the full proposal flow regardless of trip size. | When `collaborators.length <= 2` AND the proposer is an `editor`, auto-approve and add the activity directly. Add the proposal flow back when 3+ collaborators OR proposer is `voter`. **0.5 day.** |
| **F4** | **Invite acceptance auto-redirects without confirmation.** Per `InviteAcceptClient.tsx:117`: after `SIGNED_IN` event fires, `handleAcceptInvite` is called automatically. If the user signs in for a different reason (e.g. they were on the page but decided to sign in for general use first), they're auto-joined to the trip without clicking "Join trip." | `app/[locale]/invite/[token]/InviteAcceptClient.tsx:113-119`. | Either (a) keep auto-accept (it's actually a nice flow when intentional), but show a brief toast "Joined as voter — undo?" so accidental joins can back out. Or (b) require an explicit click. **30 min for toast.** |
| **F5** | **Anonymous shared-trip viewers can vote, but no "claim this trip" hook.** Someone shares a great Tokyo trip with you on /shared/[token], you vote on a few activities — there's no "Save this trip and tweak it for me" prominent CTA. The SaveTripModal exists but the user has to find a button. | `SharedTripView.tsx:80` — `showSaveModal` exists but I didn't see a prominent persistent CTA in the layout. | Add a sticky bottom-sheet on mobile + persistent top-right CTA on desktop after first vote: *"Like this trip? Save your own version →"*. Highest-leverage viral-loop hook in the product. **2-3 hr.** |
| **F6** | **No "X invited you" subject context in the bell notification when an invite is accepted by the recipient.** The notifications scaffold we shipped earlier supports `invite_accepted` as a type but no enqueue site uses it yet. | `lib/notifications/service.ts` — `enqueueNotification` only fires for `collab_vote` currently. `inviteAccepted` is in the toggle list but no code calls it. | After successful invite acceptance in `app/api/invites/[token]/route.ts`, enqueue `invite_accepted` to the trip owner. **30 min.** |

### 🔵 P3 — Polish / nice-to-haves

| # | Finding | Fix |
|---|---|---|
| **P1** | "Up to 8 Friends" copy on homepage hero — does anything enforce 8? Couldn't find a hard cap in the trip_collaborators table or API routes. May be aspirational. | Either add the cap or remove the copy. **15 min.** |
| **P2** | Mobile bottom-nav (MobileBottomNav) on shared trip view — not verified in this audit, worth checking it doesn't overlap with vote buttons on small screens. | Live test on real iPhone (or Playwright at 375px). **15 min.** |
| **P3** | ShareAndInviteModal is 780 lines — over time the share + invite tabs have grown together. Worth splitting into `ShareModalShareTab.tsx` + `ShareModalInviteTab.tsx`. | **1 day refactor.** Pure code-health; no user-visible change. |
| **P4** | The 6-vote-types displayed in `email_log` preference center map cleanly to in-app types — but the page assumes users understand "skipped_no_key" / "skipped_disabled" / "skipped_suppressed" jargon. The labels in `NotificationPreferencesClient.tsx` translate these but the underlying API still surfaces the raw strings. | **No fix needed — caught and labeled at the display layer.** |

---

## Sequencing recommendation (max impact / min effort)

If we can ship one bundle this week, prioritise:

1. **B1** — Fix the personal-message-not-shown bug (we shipped this last week, it's broken). 30 min.
2. **L2** — Stop bleeding logged-out collaborators on the generic login wall. 3 hr.
3. **L1** — Carry collaboration intent from homepage into the wizard. 2 hr.
4. **L3** — Activity preview on `/invite/[token]`. 3 hr.
5. **F5** — Save-this-trip persistent CTA on shared trips. 2-3 hr.

**Total: ~1 day of focused work for the 5 highest-leverage fixes.**

Then in a v1.1 polish round:

6. **L5** — Real-time presence (1-2 days, the biggest "wow" item).
7. **L4** — Owner onboarding (2 hr).
8. **F2** — What-changed badges (1 day).
9. **F3** — Auto-approve in 2-person trips (0.5 day).
10. **F6** — `invite_accepted` notification enqueue (30 min).

---

## What I did NOT test (worth doing next)

- **The actual collaborator flow with two real authenticated users.** I tested the anonymous side (the highest-leverage drop-off points). Driving through "owner invites, recipient accepts, both vote, owner sees notification" needs seeded test accounts.
- **Real-time proposal updates.** Code uses Supabase Realtime but I couldn't verify the UX of a vote appearing live on another user's screen.
- **Mobile WebView behavior of the share sheet.** `lib/native/share.ts` ships native share via Capacitor, but unverified inside an actual native shell (TestFlight).
- **What happens when an invite recipient signs up vs signs in.** Two slightly different paths through auth → need to verify both auto-accept correctly.
