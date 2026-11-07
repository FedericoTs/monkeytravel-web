# Analytics: which source answers which question

Binding for every number about visitors, sessions, sign-ups or saves quoted in a plan, a pull request, a dashboard or a conversation. Each tool below sees a different slice of the same visits, and the slices move independently. Read this before quoting a number or reacting to one.

## The sources

| Source | What it sees | Use it for | Never use it for |
|---|---|---|---|
| `page_views_human` → `page_view_rollup` → the admin RPCs | Every page view on production, minus self-declared crawlers, prefetches and sessions labelled as automation | How many people came, from where, to which pages | — |
| Our event tables (`wizard_step_events_human`, `funnel_events`, `consent_events`, `session_engagement`, `trip_views`, `trip_participants`) and the records themselves (`users`, `trips`, `kept_plans`) | What visitors did, written by our own code whatever they answered on the cookie banner | Funnel and activation counts, saves, the share loop, the consent rate | — |
| Search Console | Clicks and impressions from Google search, on Google's own pipeline | The tie-breaker for search traffic | Other channels; the last two days |
| GA4 | Visitors who accepted analytics cookies | Rates, paths, landing pages and content inside that sample | Totals, ever |
| PostHog | Browser events from visitors who answered the banner (see *PostHog*), plus events sent from our server | Funnels, retention, paths and recordings inside that sample | Totals, ever |
| Vercel Web Analytics | Page views and five funnel milestones, without cookies or consent | Milestone counts and the ratios between them | Traffic: our automation labels don't apply to it |
| Sentry | Errors from browsers and servers, and a sample of server requests | What broke, where, and how slow the server is | Usage |

Three rules follow:

1. A traffic number that didn't come from `page_views_human`, or from the rollup and RPCs built on it, is a lead to check, not a traffic number.
2. Search Console is the tie-breaker. It shares no code, cookie or pipeline with anything we run.
3. GA4 and PostHog are samples. Their size moves whenever the cookie banner changes (its design, wording or placement) and with the mix of languages and devices. Read rates and paths from them, never totals.

## Comparing tools

- Each tool ends its day at a different midnight: our tables and PostHog in UTC, GA4 in the property's time zone (Europe/Rome), Search Console in Pacific time. Compare tools over the same whole week, never day by day.
- GA4 and Search Console are still processing their last two days. Leave those out.
- Expect the levels to differ, and compare how each one moves. The consent rate for the same period (`get_consent_funnel(from, to)`) says how big the GA4 and PostHog samples are.

## Page views: `page_views_human` and the rollup

**Recording.** The middleware writes a `page_views` row for each browser navigation (a GET with `sec-fetch-dest: document`, see `lib/analytics/page-view-classifier.ts`), on production only. In-app navigations are recorded by `components/analytics/PageViewBeacon.tsx` through `/api/page-view`. A prefetch never counts. The session is the `mt_session_id` cookie. Every response carries `x-mt-pv: counted | counted;dry | skip:<why>`, so a deployment can be checked with curl.

**The human view.** `page_views_human` is `page_views` without the rows marked `is_bot` (self-declared crawlers, `lib/analytics/bot-detection.ts`), the rows marked `is_prefetch` (see *Things that mislead*), and the session-days labelled as automation in `page_view_session_labels`.

**When numbers land.** Two nightly jobs cover the last three UTC days: `label_automation_sessions()` at 02:20 UTC, then `refresh_page_view_rollup()` at 02:40 UTC. Yesterday is complete after 02:40 UTC. Older days keep the figures they were built with, so a change to the labelling rules shows as a step in the daily series. Windows on either side of a step aren't comparable.

**The rollup.** `page_view_rollup` holds one row per UTC day and `dimension`:

- `total`: human views, and `unique_visitors`, which counts distinct sessions that day, not people.
- `all`: every view, crawlers and automation included.
- `country`, `city`, `path`, `section` and `referrer`.
- `entry_channel`: see *Where visitors come from*.

The admin dashboard reads it through the `get_page_views_*` RPCs, `get_engagement_metrics` and `get_acquisition_breakdown` (`app/api/admin/stats/route.ts`, `lib/admin/stats/`).

**Access.** Only the service role can read `page_views` and `page_views_human`. User agents are stored once, in `user_agents`; read them through `page_views_with_ua`. How long rows are kept is under *Retention*.

## Automation labels

`label_automation_sessions()` writes one row per session and day it judges automation, with a `reason`. A session that several rules match gets the reason of the first in this list. The order changes only the recorded reason, never whether the session leaves the human view. The thresholds are in the function.

| `reason` | What it catches |
|---|---|
| `phantom_prefetch` | A session made only of link prefetches whose page landed in another session |
| `document_burst` | Full page loads in a burst no person produces, from a session that never signed in |
| `heavy_unengaged` | A very heavy session that never signed in and never fired the engagement beacon |
| `ua_city_sweep` | Many sessions in a day from one city with one exact user-agent string, almost none engaged |
| `ua_family_sweep` | The same with the browser version taken out of the user agent, for pools that rotate versions |
| `family_conversionless` | A large group from one city and one browser family, with many views per session, where nobody signed in or used the planner. Its engaged members go too |
| `ua_lagging_fleet` | One exact user-agent string across many sessions in a day, nobody signed in, and either several Chrome versions behind the day's newest, about one view per session, or spread over many countries |
| `nocity_lagging_fleet` | One-view, never-signed-in sessions with no city on the geo lookup and an outdated Chrome, when many come from one country that day |
| `stale_chrome` | A Chrome version far behind current releases that never signed in, engaged or not |
| `legacy_sweep` | One city and one user agent with many multi-page sessions, on days before engagement data existed |
| `cookieless_internal_entry` | A session whose only row is one anonymous view with our own site as the referrer, and no sign that it ran our JavaScript (no engagement, consent, wizard or funnel row). Protected `/trips` and sign-in paths, and sessions seen on another day, are exempt |
| `entry_burst_fleet` | Many one-view, no-referrer, never-signed-in sessions opened in one short window, nearly all on different paths: a sitemap crawl |
| `wizard_landing_fleet` | One anonymous, no-referrer view of `/trips/new` whose wizard rows never pass step 1, gone before the first heartbeat without engaging, when several come from one place that day. Engaged members of that group go too |

`phantom_prefetch` covers only rows from before the prefetch fix, and `legacy_sweep` only days before engagement data. Their cutoffs are `v_fix` and `v_engaged_from` in the function, so neither fires on new days. `document_burst` covers only rows after the fix.

Labelling never blocks. `page_views` keeps every row until its retention ends; only the human view and what is built on it change. Never block or rate-limit traffic because of a number: label it.

## Where visitors come from

GA4's channel report is the channel mix of people who accept cookies. Ours is `page_view_rollup` with `dimension = 'entry_channel'`, built from each session's first human view:

- `key_1` is the channel, from `acquisition_channel(referrer)`: `direct`, `internal`, `dev`, `ai_assistant`, `google`, `bing`, `other_search`, `social` or `other`.
- `key_2` is the section the session entered: `landing`, `trips`, `blog`, `destinations`, `shared trip` or `other`.
- `views` counts the sessions that entered there (the one dimension where it counts sessions), and `unique_visitors` those that reached `/trips/new` in the same session. A session that spans midnight counts on the day it started.

Read it with `get_acquisition_breakdown(p_days)` for the mix and `get_acquisition_trend(p_days)` for movement. Two things to know:

- `internal` is a gap in measurement, not a channel: the session's first recorded view already came from our own site, so its real entry was missed. The admin panel shows it as "Continuation (unattributed)" rather than folding it into Direct.
- `ai_assistant` is tested before `google` and `bing`, because Gemini and Copilot referrers carry those hosts.

## Our other records

- **The planner funnel.** Read `wizard_step_events_human`: `wizard_step_events` minus the labelled session-days, because a fleet that runs our JavaScript fires wizard events too. `get_ux10x_rates` and `vw_ux10x_daily_baseline` read it. Two functions read the raw table on purpose: `label_automation_sessions()`, which needs the events before any label exists, and `compute_wizard_planning_stats()`, which repeats the label test within its own window (`lib/analytics/stats-cache.vitest.ts` keeps the two in step).
- **Engagement.** `session_engagement` holds the sessions that kept a page in view for a few seconds (`components/analytics/EngagementBeacon.tsx` → `/api/page-engaged`). It is the "is this a person" signal behind several labels.
- **Trip opens.** `trip_views` has one row per trip, session and UTC day (`app/api/trips/[id]/view/route.ts`, `lib/analytics/trip-view.ts`). It feeds the North Star: whether a trip is opened during the trip by its own people (owner, collaborator or participant). Opens by anyone else are reported beside it.
- **Participants.** `trip_participants` has one row per trip and participant cookie that tapped "I'm going"; `left_at` is set on "Not going" or when the owner removes them. Read it with `get_live_trip_participant_metrics()`, as the service role.
- **Shared-link visits.** `funnel_events.share_link_visited` is a page load, by someone other than the owner, of a trip that has an owner (`lib/analytics/share-visit-classifier.ts`). PostHog's `crew_link_visited` follows the same verdict. `metadata.crew_ask` is true when the link asked the group to vote (`?vote=1`).
- **Consent.** `consent_events` records the banner being shown and minimised and each decision (`accept_all`, `essential_only`, `settings_saved`), with the banner variant, the page and where the decision was taken (`origin`: the banner card, the minimised bar or the settings window). `get_consent_funnel(from, to)` and `get_consent_funnel_by_origin(from, to)` return the rates.
- **Baseline.** `get_live_trip_baseline()` and `scripts/baseline-snapshot.mts` give all of the above in one reproducible block over the last N full UTC days, or for a past window with `--to=YYYY-MM-DD`.
- **Suppressed visa reminders.** A `scheduled_notifications` row with `skipped_reason` `domestic_trip:<country>` is a visa reminder that wasn't sent because the trip is in the traveller's own country (`lib/notifications/domestic-trip.ts`).

## Retention

`purge_old_analytics_rows()` runs every night (pg_cron `purge-old-analytics-rows`):

- `page_views`: human rows 90 days, the rows the human view leaves out 7 days. `page_view_rollup` keeps the daily totals.
- `wizard_step_events`: 90 days, and the planner's step-1 heartbeats 14 days.
- `page_view_session_labels`: at least 14 days, and up to 90 while that session's wizard events or trip opens from the same day remain, so the human funnel stays clean for as long as it can be read.
- `consent_events`: banner impressions 30 days, decisions 13 months. Acceptance rates can be read for the last month only.

A question about a longer window needs the rollup, or a snapshot saved at the time.

## Reading a traffic alarm, in this order

1. **Search Console first:** `npx tsx scripts/gsc-daily.mts`. If organic clicks are flat, search traffic didn't move.
2. **Human views by day:** `select day, views, unique_visitors from page_view_rollup where dimension = 'total' order by day desc limit 14`. Compare the day with the previous week's range, not with the day before.
3. **Was the reference day inflated?** `select reason, count(*), sum(views) from page_view_session_labels where day = '<day>' group by 1`. A large sweep on the day before a drop means the drop is the sweep ending.
4. **Raw against human on that day:** the rollup's `all` against `total`. A gap much wider than on the days around it is automation, labelled or not yet.
5. **Device and country split** of the suspicious sessions. Real visitors spread across devices and plausible markets; a desktop-heavy, single-city group that never engages is a script.
6. **Only then GA4 or PostHog**, for how consented visitors behaved, never to size the change.
7. **Don't change tracking, tags or middleware** because of a number until steps 1 to 5 are done. Never block traffic: label it.

## Things that mislead

- **`is_bot` knows only self-declared crawlers**, on purpose (`lib/analytics/bot-detection.ts` says why). A script that presents as Chrome passes it; the labels are the second layer.
- **A heavy session isn't a bot by itself.** The heaviest sessions are often engaged people. Automation shows as a group: one place, one browser, many sessions, no engagement.
- **Pools that rotate their user-agent string never trip a per-string rule.** The family and no-city rules exist for them. Before reading traffic from Google or from one country, split it by `page_view_session_labels.reason`.
- **A fleet that runs our JavaScript fires wizard events.** Read the funnel from `wizard_step_events_human`, never from the raw table.
- **Engagement data has a start.** "Never engaged" means nothing for days before the first `session_engagement` row.
- **Local development and preview deployments record no page views** (`x-mt-pv: counted;dry`). Check tracking on production, with a probe.
- **A probe on production writes real rows** under an `e2eprobe-` session until they're deleted. Some reads skip that prefix; `page_views_human` doesn't.
- **React StrictMode fires mount beacons twice in development.** The database dedupes them.
- **Calls through the API run under a statement time limit**, so a query that finishes in the SQL editor can time out from a script. Read the rollup, or a short recent window of `page_views_human`.
- **A trip open is one per visitor, trip and UTC day:** opening `/trip/x` and then `/shared/x` the same day is one `trip_views` row.
- **Consent makes GA4 and PostHog partial.** Read activation from our database (`/admin`), not from a consent-gated tool.
- **Rows from before the prefetch fix over-count.** Each link prefetch used to be recorded as a view, and prefetches that raced the session cookie became sessions of their own. Those rows are marked `is_prefetch` and those sessions labelled `phantom_prefetch`, so the human view leaves both out. But one row per burst survives, and a link prefetched later, as it scrolled into view, still reads as a visit. Path-level numbers from before the fix stay approximate; for "went on to X" across it, use an event X fires itself, not a page view of X.

## Search Console

Clicks and impressions from Google search, on Google's own pipeline. `npx tsx scripts/gsc-daily.mts` prints the daily series; set `DAYS` for another window. It needs the Search Console service-account key (see the script). Its days end at midnight Pacific time, and its last two days are incomplete. It covers Google search only.

## GA4

GA4 loads only on `monkeytravel.app`, in Google's Consent Mode "advanced": before a choice, and after "Essential only", the tag sends cookieless pings and stores nothing. Google turns such pings into modelled visitors only for properties with enough consented traffic to qualify for its behavioural modelling, and this one doesn't. So GA4 reports the visitors who accepted analytics cookies. The events it receives, its setup and how to read it are in `docs/GA4_SETUP_GUIDE.md`.

## PostHog

**Who it sees.** The SDK loads for everyone at idle (`instrumentation-client.ts`) but captures nothing until the visitor answers the cookie banner.

- **Accept:** normal capture, with a cookie.
- **Essential only:** cookieless capture: no cookie or storage, an id PostHog computes on its servers and changes daily, and `$cookieless_mode` on every event (`lib/analytics/posthog-consent.ts`). PostHog keeps these events only when the project setting "Cookieless server hash mode" (Project settings → Web analytics) is on. Until it is, they are dropped on arrival, and PostHog's browser events come only from visitors who accepted.
- **No answer:** nothing is captured.

Session recordings run only with both analytics and session-recording consent.

**Events from our server.** Events sent through `captureServerEvent` (`lib/posthog/server.ts`) don't depend on the banner: the share loop (`crew_link_created`, `crew_link_visited`, `participant_joined`, `crew_vote_cast`), copying and publishing trips, AI generations (`$ai_generation`) and a few more. Their id is the account id, a functional browser cookie, a per-visit id, or a shared placeholder such as `anonymous` when there is nobody to name; `crew_link_visited` says which in `visitor_scope`. Don't count unique people across those kinds of id.

**Identity.** Only identified people get a person profile (`person_profiles: "identified_only"`). With analytics consent, the code identifies a person at sign-up, at sign-in and on signed-in page loads, with profile properties that include the account's email and name. At sign-up and sign-in it also links the browser's anonymous id to the account, so the path before signing up joins the person (`lib/posthog/identify.ts`). A visitor on "Essential only" is never tied to an account. After the sign-out reset ships, a browser with no session that PostHog still knows as a signed-in person starts again as a new anonymous visitor.

**Link keys.** `before_send` replaces the key in every address on an event, on the person properties it sets and in a recording's page-change entries (`lib/analytics/scrub-url.ts`). Paths become `/shared/:token`, `/invite/:token`, `/feedback/:token` and `/join/:code`, and the `token`, `code`, `token_hash`, `k` and `s` query parameters go, as does a fragment that carries parameters.

**Hosts.** PostHog loads wherever its key is set, a development server or a preview deployment included. The project's internal and test users filter should leave those hosts out and be on by default. Events sent from our server carry no `$host`, so the filter should exclude the other hosts rather than require the production one.

**The growth dashboard.** PostHog → Dashboards → "Growth: activation, return, share loop". Every insight filters out internal and test users.

- **Activation:** step 1 of the planner, then a plan, then a saved trip, within 7 days, by device type.
- **New visitor's save path:** a plan, then asked to sign in to save, then signed up, then saved, within 7 days.
- **Return:** of the people who signed up each week, the share who viewed a page in each following week.
- **Share loop:** each week's share links created, link visits, people joining a trip, votes cast, and plan links copied without an account.
- **Sky test:** a plan, then a saved trip, split by `result_variant` (`sky` or `classic`). A readout aid; the official readout is `wizard_step_events.result_variant` in our database.

To read it:

- Activation, the save path, return and the sky test use browser events, so they show the consented sample. Read the conversion between steps, not how many entered.
- A visitor on "Essential only" gets a new id every day, so views that span days follow only visitors who accepted. Return also needs a signed-in person.
- The share-loop lines are server events and don't depend on the banner, except "plan links copied", a browser event. Compare the server lines with each other, such as visits per link created, not with the browser line.
- Volumes are small. Compare weeks, and look at the counts under a rate before trusting it.

## Vercel Web Analytics

`<Analytics />` runs on Vercel deployments (`app/[locale]/layout.tsx`). It needs no cookies and no consent, so it also counts the visitors GA4 and PostHog miss. Besides page views, `trackMilestone` in `lib/analytics.ts` sends five funnel milestones, each with at most two properties (the plan's limit):

| Event | Properties |
|---|---|
| `itinerary_generated` | `days` |
| `plan_kept` | `days` |
| `sign_up` | `method` |
| `trip_created` | `from` (`template` for a ready-made trip, otherwise `planner`), `days` |
| `share` | `method` |

Use it for milestone counts and the ratios between them. Its page views don't pass through our automation labels, so traffic still comes from the rollup. A milestone fires in the browser, which a fleet running JavaScript can reach too: when one jumps, check it against our own tables.

## Sentry

**Browser.** Errors only. The SDK isn't in any page's bundle: two window hooks catch errors from the start, and the SDK is fetched on the first error, or at idle for a visitor who agreed to session recording (`lib/observability/sentry.ts`). The browser sends no traces. Session replay records only with session-recording consent. `ignoreErrors` and `denyUrls` in `instrumentation-client.ts` drop noise from extensions, dropped connections and translation proxies. React error boundaries report through `lib/observability/report-boundary-error.ts`, with the raw stack, Next's error digest and the route.

**Server and edge.** Errors, and tracing on a sample of requests (the rate is in `sentry.server.config.ts` and `sentry.edge.config.ts`), sent as one transaction per request (`traceLifecycle: "static"`).

**Handled failures.** A failure the code handles itself throws nothing, so Sentry's hooks never see it. Two paths report it through `lib/observability/server-failure.ts`:

- `apiError` (`lib/api/response-wrapper.ts`) with a 5xx status other than 503, as an error. A 503 is a service switched off, or a model outage the AI code reports itself.
- `logWriteError` (`lib/supabase/log-write-error.ts`) on the server, for a refused database write the code carries on from, as a warning. Browser pages that call it only log.

Each kind (its fingerprint) is sent at most once a minute per server instance, after the response. So an issue's event count tells you in how many minutes it happened, per instance, not how many requests failed. For counts, read the function logs.

**Tracing stays in the server build.** `next.config.ts` must not set `bundleSizeOptimizations.excludeTracing`. `withSentryConfig` turns it into a build-time flag that also applies to the server and edge bundles, which removes tracing there, and then no spans are sent at all. `lib/observability/sentry-trace-lifecycle.vitest.ts` fails if it comes back. The browser needs no such flag: it never traces.

**Source maps.** The build uploads them when `SENTRY_AUTH_TOKEN` is set (`next.config.ts`). A failed upload logs a warning and the build carries on, and that build's stacks stay minified.

**Releases and environments.** The release is the commit (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`). The environment comes from `NODE_ENV`, so every deployed build, preview or production, reports `production`. Local development reports nothing unless `SENTRY_ENABLE_DEV=1` (server) or `NEXT_PUBLIC_SENTRY_ENABLE_DEV=1` (browser) is set.

**What it collects.** `lib/observability/sentry-data-collection.ts` lists what Sentry may send besides the error, in every runtime.

**Alerts.** A notification rule for high-priority issues, and an uptime monitor on `/api/health`, which checks the database too. There is no alert on error volume, and the scheduled jobs have no Sentry monitors, so a job that stops running raises nothing.

## Where the pieces live

| What | Where |
|---|---|
| What counts as a page view | `lib/analytics/page-view-classifier.ts`; recorded by `lib/supabase/middleware.ts` (`trackPageView`, the `mt_session_id` cookie) and `components/analytics/PageViewBeacon.tsx` → `/api/page-view` |
| Crawler detection | `lib/analytics/bot-detection.ts` |
| Labels and the human view | `label_automation_sessions()`, `page_views_human`, `page_view_session_labels`; pg_cron `label-automation-sessions` |
| Rollup | `refresh_page_view_rollup()`; pg_cron `refresh-page-view-rollup` |
| Retention | `purge_old_analytics_rows()`; pg_cron `purge-old-analytics-rows` |
| Engagement beacon | `components/analytics/EngagementBeacon.tsx` → `/api/page-engaged` → `session_engagement` |
| Trip opens | `app/api/trips/[id]/view/route.ts`, `lib/analytics/trip-view.ts` |
| Shared-link visits | `lib/analytics/share-visit-classifier.ts`, `lib/analytics/funnel-events.ts` |
| Baseline | `get_live_trip_baseline()`, `scripts/baseline-snapshot.mts` |
| Label check | `scripts/automation-labels-probe.mts` |
| Admin dashboard | `app/api/admin/stats/route.ts`, `lib/admin/stats/` |
| Search Console | `scripts/gsc-daily.mts` |
| GA4 | `docs/GA4_SETUP_GUIDE.md` |
| PostHog | `instrumentation-client.ts`, `lib/posthog/`, `lib/analytics/posthog-consent.ts`, `lib/analytics/scrub-url.ts` |
| Vercel Web Analytics | `lib/analytics.ts` (`trackMilestone`), `app/[locale]/layout.tsx` |
| Sentry | `instrumentation-client.ts`, `instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `lib/observability/`, `next.config.ts` |
