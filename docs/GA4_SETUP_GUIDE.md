# GA4: setup and how to read it

GA4 here is a sample: the visitors who accepted analytics cookies. Use it for rates, paths, landing pages and content inside that sample, never for totals. How many people came, signed up or saved a trip comes from our own tables: see `docs/ANALYTICS_SOURCES_OF_TRUTH.md`.

## How the tag loads

- **Production only.** `components/analytics/ConsentGatedTags.tsx` loads the tag only when the page's host is `monkeytravel.app`. A development server, a preview deployment or a translation proxy serves the same pages under another host and never loads it. `www` redirects to the bare domain before any page renders.
- **The measurement id** comes from `NEXT_PUBLIC_GA_MEASUREMENT_ID`, set in the deployment's environment, not in the repo.
- **After the page.** gtag.js is fetched once the page has finished loading, so it never slows the page down; its commands queue until then. GA4's setup check may say the tag isn't placed correctly. That's expected.
- **Consent Mode v2, "advanced"** (`lib/analytics/ga-consent.ts`). The root layout (`app/[locale]/layout.tsx`) puts a default of every storage type denied in `<head>`, before the tag. Accepting analytics grants `analytics_storage`; accepting marketing grants `ad_storage`, `ad_user_data` and `ad_personalization`. Before a choice, and after "Essential only", the tag sends cookieless pings: no cookie, no client id, nothing stored. Withdrawing consent deletes the `_ga`, `_gid` and `_gcl` cookies set while it was granted. `ads_data_redaction` is on.
- **The alternative.** `NEXT_PUBLIC_GA_CONSENT_MODE=gated` mounts the tag only after a visitor accepts, with no code change.

## Who GA4 sees

Google uses cookieless pings to model the visitors who declined only in properties with enough consented traffic to qualify for its behavioural modelling. This property doesn't qualify, so its reports hold the visitors who accepted analytics cookies, minus the team's browsers once the Internal Traffic filter is active.

How many visitors accept moves with the banner's design, wording and placement, and with the mix of languages and devices. So:

- Read rates inside GA4, such as sign-ups per plan or the share of landing-page sessions that reach a plan. Never read totals.
- Don't compare GA4 numbers across a change to the banner.
- GA4's channel, country and device mixes are the mix of people who accept. For everyone, read the rollup's `entry_channel` and `country` rows.
- To size the sample for a week, divide GA4's organic Google sessions by Search Console's clicks for the same week, or read the acceptance rate with `get_consent_funnel(from, to)`.

## What the code sends

Every event goes through `trackEvent` in `lib/analytics.ts`. GA4's own `page_view`, `session_start`, `first_visit` and `user_engagement` come from the tag; the code sends no versions of its own. Page views on in-app navigation come from Enhanced measurement (see *Setup*).

Every event the code sends also carries two parameters:

- `locale`: the page's `<html lang>`, so `en`, `es`, `it` or `pt`, or the target language when the browser's translator has translated the page.
- `signed_in`: whether the page has seen a signed-in account yet. It turns true at sign-in, or when `SessionTracker` confirms the session at idle after a page loads, and stays true until the next full page load. An event sent before that carries `false` even for a signed-in person: a trip page's `trip_viewed` on a fresh load, or the `sign_up` and `login` of an email account.

**Key events:** `sign_up`, `trip_created` and `plan_kept`.

### Planner, accounts and sharing

| Event | Sent when | Parameters |
|---|---|---|
| `destination_selected` | A destination is picked in the planner | `destination`, `selection_source` (`autocomplete` or `popular`) |
| `itinerary_generated` | The planner shows a finished plan | `destination`, `duration_days`, `budget_tier`, `generation_time_ms` |
| `plan_kept` | A plan is kept by its link, without an account | `duration_days` |
| `sign_up` | An account is created | `method` (`email` or `google`) |
| `login` | Someone signs in | `method` |
| `trip_created` | A trip is saved: from the planner, from a ready-made trip, or as a copy of a shared trip | `trip_id`, `destination`, `duration_days`, `budget_tier`, `is_from_template` |
| `share` | A trip is shared: a link created or copied, sent to WhatsApp, X or email, or shared as a picture | `content_type` (`trip`), `item_id` (the trip id), `method` (`link`, `social`, `email` or `image`) |
| `referral_link_clicked` | Sent with `share` when the share link is copied, despite its name before anyone clicks it | `referral_code` (the trip id), `share_medium` (`copy`) |
| `share_modal_opened` | The share window opens | `trip_id`, `trip_destination` (the trip's title) |
| `share_prompt_shown` | The prompt to invite people appears after a save | `trip_id`, `trip_destination`, `trip_days`, `location` (`post_save`) |
| `share_prompt_action` | Someone answers that prompt | `trip_id`, `action` (`invite` or `skip`), `location` |
| `share_link_clicked` | A shared trip page opens, for anyone, the owner included | `trip_id`, `referrer` (`direct` when there is none) |

### Trips, content and returns

| Event | Sent when | Parameters |
|---|---|---|
| `trip_viewed` | A signed-in owner or collaborator opens a trip page | `trip_id`, `is_own_trip` (always `true`, collaborators included), `trip_status`, `days_since_creation` (despite its name, the days between today and the trip's start date, in either direction), `activities_count` |
| `activity_completed` | An activity is ticked off during a trip | `trip_id`, `activity_id`, `day_number` |
| `activity_regenerated` | An activity is swapped for a new suggestion | `trip_id`, `activity_type` |
| `ai_assistant_used` | A message is sent to the trip assistant | `trip_id`, `message_length` |
| `view_item` | A ready-made trip opens | `content_type` (`template`), `item_id`, `item_name` |
| `template_copied` | A ready-made trip is saved | `template_id`, `template_name`, `destination` |
| `content_viewed` | A blog or destination page opens | `content_type` (`blog_post`, `blog_index`, `destination` or `destination_index`), `content_id`, `content_group` (`blog` or `destinations`), and the page's details: `category`, `reading_time` and `author` for a post; `continent`, `country` and `budget_level` for a destination; `total_posts` or `total_destinations` for an index |
| `content_interaction` | On the blog: a filter, a change of page, each quarter of a post read | `action` (`filter`, `paginate` or `read_milestone`), `content_group`, and `filter_type` with `filter_value`, `page` with `total_pages`, or `content_id` with `percentage` |
| `user_return` | A signed-in person comes back after more than 30 minutes with no page of the site in view | `days_since_last_visit`, `return_bucket` (`same_day`, `d1`, `d2_7`, `d8_30` or `d30_plus`) |

### Onboarding and the beta code

These come from the onboarding screens, which open after a password sign-in with no page to return to, and only for an account that finished the old welcome step but not onboarding; and from the beta-code box on the profile page.

| Event | Parameters |
|---|---|
| `onboarding_step_viewed` | `step_number`, `step_name` |
| `onboarding_step_completed` | `step_number`, `step_name`, `selections_count`, `selections` |
| `onboarding_completed` | `total_steps`, `was_skipped`, `travel_styles_count`, `dietary_count`, `accessibility_count` |
| `onboarding_skipped` | `skipped_at_step` |
| `beta_code_attempt` | `code_entered`, `success`, `error_reason` |
| `early_access_redeemed` | `code_id` |

### User properties

`components/analytics/SessionTracker.tsx` sets these on each signed-in page load, once the account's reads succeed:

| Property | Value |
|---|---|
| `user_stage` | `new` (no trips), `activated` (one), `engaged` (two to four) or `power_user` (five or more) |
| `trips_count` | Trips the account owns |
| `account_age_days` | Days since the account was created |
| `subscription_tier` | The account's tier, `free` when unset |
| `onboarding_completed` | Whether onboarding was finished |
| `has_beta_access` | Whether the account has beta access |

The account id is also set, at sign-up, at sign-in and on signed-in page loads, as a user property named `user_id`. GA4 reserves that name, and its User-ID features read the tag's own `user_id` field, which the code doesn't set. So GA4 doesn't join one person's devices.

### Content group

On blog and destination pages, `components/analytics/ContentTracker.tsx` calls `gtag("set", { content_group })` (`blog` or `destinations`), so the page's hits carry it. It is a `set`, not a second `config`: a second config would set the tag up again without the team's `traffic_type`, and could send a page view of its own.

### Link keys

Some addresses work as keys: whoever has one can open what it points to. They are `/shared/<token>`, `/invite/<token>`, `/feedback/<token>` and `/join/<code>`, and the query parameters `token`, `code`, `token_hash`, `k` and `s`. When a page opens at such an address, the tag's config gets a `page_location` with the key replaced (`/shared/:token`, `/join/:code`) and those parameters removed, along with any fragment that carries parameters (`lib/analytics/scrub-url.ts`). GA4's query-parameter redaction, set up below, removes the same parameters from every hit.

## Setup

In GA4 Admin:

1. **Key events** (Data display → Key events): `sign_up`, `trip_created` and `plan_kept`. GA4's template key events (`close_convert_lead`, `qualify_lead`, `purchase`) are events this site never sends: leave them unmarked.
2. **Custom definitions** (Data display → Custom definitions):
   - Event-scoped dimensions: `locale`, `signed_in`, `destination`, `budget_tier`, `selection_source`, `action`, `is_from_template`, `trip_status`.
   - Custom metrics: `duration_days` (standard) and `generation_time_ms` (milliseconds).
   - User-scoped dimension: `user_stage`.

   GA4 already has `content_group`, `content_type` and `method`. Leave ids (`trip_id`, `item_id`, `activity_id`, `template_id`) unregistered: questions about one trip belong in the database. A definition fills only from the day it is created.
3. **Internal traffic.** Open `https://monkeytravel.app/?mt_team=1` once in each browser the team uses. The mark lives in that browser's local storage, and its hits then carry `traffic_type: internal`; `?mt_team=0` removes it. A private window or another browser isn't marked. Probes on production are marked too: they set their own `e2eprobe-` session cookie, which the page can read. Then turn the filter on: Data collection and modification → Data filters → Internal Traffic → Active. A filter applies from the moment it is active, not to past data.
4. **Data retention** (Data collection and modification → Data retention): event data 14 months. Retention limits explorations; standard reports keep their totals.
5. **Unwanted referrals** (Data streams → the web stream → Configure tag settings → List unwanted referrals): `accounts.google.com`. Signing in with Google sends the visitor there and back; without this rule GA4 records the return as a referral and credits the sign-up to it rather than to where the visitor came from.
6. **Redact data** (Data streams → the web stream → Redact data → Query parameters): `token`, `code`, `token_hash`, `k`, `s`.
7. **Enhanced measurement** (Data streams → the web stream): keep Page views on, with "Page changes based on browser history events". The code sends no page view of its own on in-app navigation.

To check the tag, use a browser that isn't marked as the team's: once the filter is active, a marked browser's hits are dropped.

## Reading GA4

- **Rates, not totals.** See *Who GA4 sees*.
- **Two days late.** GA4 is still processing its last day or two: their events keep arriving and many of their sessions show as Unassigned. Leave them out.
- **Day boundaries.** GA4's days end at midnight in the property's time zone, Europe/Rome. Search Console's end at midnight Pacific time, and our tables' and PostHog's at midnight UTC. Compare tools over the same whole week, never day by day.
- **`signed_in` is late on a fresh page.** Split by it only events sent well after a page loads, such as `user_return` or a share; see *What the code sends*.
- **Not its own evidence.** When GA4 shows a drop, check Search Console and the rollup first (*Reading a traffic alarm* in `docs/ANALYTICS_SOURCES_OF_TRUTH.md`).
- **Small numbers.** Compare weeks, and look at the counts behind a rate before trusting it.

## Where it lives

| File | What it does |
|---|---|
| `components/analytics/ConsentGatedTags.tsx` | Loads the tag on the production host, applies the visitor's consent, marks team browsers, and gives the config a `page_location` without link keys |
| `lib/analytics/ga-consent.ts` | The consent default and how the banner's choices map onto it |
| `lib/analytics/scrub-url.ts` | Which addresses are keys, and how they are replaced |
| `lib/analytics.ts` | Every event and user property, the content group, and the Vercel Web Analytics milestones |
| `components/analytics/SessionTracker.tsx` | User properties and `user_return` |
| `components/analytics/ContentTracker.tsx` | `content_group` and `content_viewed` |
