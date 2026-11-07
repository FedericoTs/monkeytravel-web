# CLAUDE.md

Guidance for anyone, human or AI, changing code in this repository.

## Project

**MonkeyTravel** is an AI travel planner at https://monkeytravel.app. A visitor plans
a trip in the wizard without an account, Gemini writes the itinerary, and signed-in
users save it, edit it with the assistant, share it and plan it with friends.

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- Supabase (Postgres, auth, row-level security), hosted on Vercel
- Gemini for itineraries and the assistants
- next-intl with four locales: `en` (no URL prefix), `es`, `it`, `pt`
- The GitHub repo is **public**: https://github.com/FedericoTs/monkeytravel-web.
  `master` deploys to production. A pull request gets a Vercel preview only when
  asked (`ignoreCommand` in vercel.json): push it to a branch named `preview/…`,
  or put `[preview]` in a commit message. CI builds every pull request anyway.

## What matters here

Making a plan no longer sets anyone apart, and many people who get one leave. So a
change is worth making when it helps someone trust the plan, use it on the day, in
their language, with the people they travel with, and with no surprise charges.
Features people never reach aren't the goal.

- **Real frustration goes first.** If real sessions or logs show someone stuck today,
  that comes before new work.
- **Judge by what people do.** Read the numbers before and after a change. Volumes are
  low, so say when a number is thin.
- **Don't touch the path from a finished plan to a saved trip for taste.** A restyle
  there needs a before-and-after read and a way back, because a small change can stop
  saves altogether.

## Commands

```bash
npm run dev                  # dev server, http://localhost:3000
npm run build                # production build
npm run typecheck            # app + test files (tsconfig.json, tsconfig.test.json)
npm run lint -- --quiet      # ESLint, errors only
npm test                     # Vitest unit tests (*.vitest.ts / *.vitest.tsx)
npm run test:e2e             # Playwright, tests/e2e/
npm run test:e2e:prod        # the @prod subset against https://monkeytravel.app
```

CI (`.github/workflows/`) runs on every pull request: `typecheck`, lint with a warning
ceiling, the unit suite, a production build, the public browser tests, the signed-in
browser tests on a local database, and the guards for secrets, personal data, tenants
and storage. See *Before you push*.

## How to change this codebase (MANDATORY)

Unneeded changes, old code left behind and history written into comments are what
make each following session slower and riskier. Every change follows these rules:

1. **Make the smallest change that solves the problem.** No drive-by refactors,
   renames or reformatting. If you notice something else, tell the user instead.
2. **One concern per pull request.** A fix, a feature and a refactor are three PRs.
3. **Extend the module that owns the behaviour** (see *Module owners*). Search before
   writing a helper; a near-duplicate module is how this repo ended up with two date
   modules and two assistants.
4. **Delete, don't disable.** When a feature is retired, remove its code, routes,
   translations and tests in the same PR. No `ENABLED = false`, no commented-out code.
5. **Comments say why the code is shaped this way, in five lines or fewer.** No
   dates, metrics, PR numbers, names or incident stories: those go in the commit
   message and the PR description.
6. **The repo is public.** Never put a real person's name, email address or data in
   code, tests, fixtures, comments or docs. Use made-up names and `example.com`.
7. **Every user-facing string exists in all four locales** (see *Internationalization*).
8. **Verify in the real thing, not only in tests,** including one non-English locale.
   See *Checking it for real*.
9. **Merge only when the user explicitly says so.**
10. **Write the failing test first, then try to break the code.** Change the new code on
    purpose, one way at a time, and check a test catches each change. A test that can't
    fail proves nothing.

## Module owners

Add to these; do not start a parallel version.

| Area | Owner |
|---|---|
| Itinerary generation (prompt, parsing) | `lib/gemini.ts`, `app/api/ai/generate/` (incl. `stream/`) |
| Regenerating an activity or a day | `lib/ai/regenerate-activity.ts`, `lib/ai/regenerate-day.ts`; calls, time limit and retries in `lib/ai/gemini-call.ts` |
| Wizard assistant (before the trip is saved) | `lib/ai/assistant/engine.ts` (`edit-prompt.ts`, `edit-validation.ts`, `edit-reply.ts` beside it), `app/api/ai/assistant-anon/`, `hooks/useAssistantEdits.ts` |
| Trip-page assistant | `app/api/ai/assistant/route.ts`, `hooks/useTripAssistant.ts` |
| Trip concierge | `app/api/ai/concierge/route.ts`; what it reads `lib/ai/concierge-trip.ts`, its answer `lib/ai/concierge-answer.ts`, its proposals `lib/ai/concierge-proposal.ts` |
| Shared assistant rules (honest replies, day targeting) | `lib/ai/assistant/` |
| Checking a pasted plan | `lib/plans/`, `app/api/tools/check-plan/` |
| A place to eat on Google Maps | `lib/places/places-to-eat.ts`; on a saved trip `lib/places/kept-trip.ts`, `check-kept-trip.ts` |
| Links into Google Maps | `lib/trips/maps-links.ts` |
| Travel times on the map | `lib/map/route-labels.ts` |
| The signed-in home's next trip | `lib/trips/waiting-room.ts`, `components/trips/WaitingRoom.tsx` |
| Answers to emails, signed links | `lib/feedback/` |
| Saving a trip | `lib/trips/persistTrip.ts`; the wizard's Save button and reports `hooks/useWizardSave.ts`, auto-save `hooks/useAutoSaveTrip.ts`, gated by `lib/trips/autoSaveGate.ts` |
| Concurrent itinerary writes | client queue `lib/trips/itinerary-sync.ts`, server compare-and-set `lib/trips/itinerary-cas.ts` |
| Changing trip dates | `lib/trips/change-dates.ts` |
| Dates | `lib/datetime/` for display formatting, `lib/dates/iso-date.ts` for `YYYY-MM-DD` input |
| Trip-page helpers (live trip, time zones, drag and drop) | `lib/trip/` |
| API route responses | `lib/api/response-wrapper.ts` (`apiError`, `errors`, `apiSuccess`); errors are `{ error: string, code?, ... }` |
| Paid-API usage and cost logging | `lib/api-gateway/api-control.ts` |
| Supabase clients | `lib/supabase/server.ts`, `client.ts`; `admin.ts` is service-role and server-only |
| Modals | `components/ui/BaseModal.tsx`; over a sticky bar pass `usePortal zIndex={100}` |
| Product analytics | `lib/posthog/` (events, `useFlag`), `lib/analytics.ts` |
| Email | `lib/email/`; scheduled ones `app/api/cron/scheduled-notifications/route.ts`, `lib/notifications/` |
| Anonymous writes on a shared trip | `lib/participants/request.ts` (`readParticipantWrite`) |
| The share window | `components/trip/ShareAndInviteModal.tsx`; its tabs `ShareLinkTab.tsx`, `InviteTab.tsx`; their state `hooks/useShareLink.ts`, `hooks/useTripInvites.ts` |
| A shared or public trip page | `app/[locale]/(app)/shared/[token]/SharedTripView.tsx`; what it asks of its reader `components/trip/SharedTripAsks.tsx`; the visit, the resumed save and the sharer's claim `hooks/useSharedTripVisit.ts`; its plan-your-own links `lib/trips/plan-own.ts` |
| A trip's days on its page | `components/trip/TripDayList.tsx` |
| Translations | `messages/{en,es,it,pt}/*.json`, locales in `lib/i18n/routing-config.ts` |

## Tests

- Unit tests sit next to the code as `*.vitest.ts(x)` (Vitest, jsdom). The main
  `tsconfig.json` excludes them; `tsconfig.test.json` type-checks them.
- Playwright specs live in `tests/e2e/`. Signed-in specs run in CI on a local database.
  `npm run e2e:fixtures` and `npm run e2e:login` use whichever database `.env.local`
  names, which can be production: don't sign in with test accounts there.
- Every button, link and form field needs a name a screen reader can say;
  `app/control-names.vitest.ts` fails the build otherwise.
- CI fails on ESLint errors and on more warnings than the ceiling in `ci.yml`. New files
  add none. Style rules and React Compiler advice are warnings (`eslint.config.mjs`); fix
  those in code you are already changing, not in bulk.

## Before you push

The unit suite catches none of these. Each has failed CI or production at least once.

1. **Run the checks in this order and stop at the first failure:** your broken-on-purpose
   checks, `npm run typecheck`, `npx vitest run`, lint, `node scripts/check-personal-data.mjs`.
   Vitest doesn't type-check, and a pipe hides a failing step.
2. **Commit before the suite when you touch a public page.** `app/sitemap-lastmod.vitest.ts`
   dates pages from git, so uncommitted edits pass locally and fail in CI. Move the page's
   `LASTMOD_*` in `app/sitemap.ts` in the same commit.
3. **A new prerendered page goes in `lib/security/static-routes.json`.** The check after the
   build (`scripts/check-static-routes.mjs`) fails otherwise, and only CI runs a build.
4. **A new browser spec goes in a workflow's list** (`e2e-public.yml`, `e2e-signed-in.yml`).
   Those are fixed lists, so a spec left off never runs and nothing says so.
   `app/e2e-specs-accounted.vitest.ts` fails on one, and the run's count should go up.
5. **Generate fake secrets at run time** (`randomBytes`, `crypto.randomUUID()`). Secret
   scanning reads every commit in a pull request, including ones you've since fixed.
6. **`errors.internal` takes a string literal** (`app/error-texts.vitest.ts`).
7. **A helper that takes a table name as a string slips past guards that scan
   `.from("x")`.** When you add one, teach the guards about it.
8. **Run one heavy job at a time.** Two full suites, or a dev server beside a suite, make
   slow tests hit their time limit and look like real failures.
9. **Never skip hooks, `git add -A`, or `git stash` in a worktree.** On conflicts, merge
   `origin/master`; don't rebase and force-push. Never write a placeholder command: it runs.

## Checking it for real

Tests pass on plenty that's wrong: a link the other site can't read, a card under a bar, a
famous restaurant reported as not found. So after the deploy, not before it:

- **Wait until the deploy is ready** (`scripts/verify-deploy.sh`). Before that you test the
  old code, and a bad request can write junk to the database.
- **Read the result, don't just count passes.** A green script says only what it was
  written to check. Look at the screenshot, and read the answer as a visitor would.
- **Open every new link in the real target,** such as Google Maps.
- **Say what's proven and what isn't.** What needs an account can't be tried on production:
  it goes in the signed-in suite, and the first real events are the rest of the proof.
- **A test with two paths prints which one it took,** so a pass isn't mistaken for the
  full walk.

On production, tag the browser with a cookie `mt_session_id=e2eprobe-...`, stub every write
that isn't under test, and delete the rows by that session afterwards. Never open a real
person's emailed link: it would answer for them.

What a local preview or a unit test can't show:

- The live theme needs `HERO_DOODLE_ENABLED=true` in `.env.local`.
- On a touch screen, `app/globals.css` sets a 44 px minimum outside any layer, which beats
  Tailwind's utilities. Use `min-h-0!`, and check with `isMobile` and `hasTouch`.
- `html` is 15 px on small screens, so `w-8` is 30 px there. Measure before quoting a size.
- `isAnalyticsBot` drops a headless browser's clicks, so set a normal `userAgent`.
- A dev server with production keys writes to production. Placeholder
  `NEXT_PUBLIC_SUPABASE_*` values in a worktree are the safe way to look at a page.

## Production is shared, and small

- **No whole-table reads in a loop, and no `t::text like` scans across tables.** One query
  that returns little, or small pages with a pause that stop when a read slows down.
  Work a list out once and save it. Stay away from 02:15 to 03:45 UTC, when nightly jobs run.
- **PostgREST returns at most 1,000 rows and doesn't say so,** even with `.limit(100000)`.
  Use `lib/supabase/read-all-rows.ts`.
- **Anything that spends gets a cap before it ships,** and a read of real usage after. A
  check that makes a few extra calls per visit adds up.
- **A logged cost at list price isn't the bill.** Take off the free allowances before
  quoting a number.
- **Every merge to `master` rebuilds production,** so don't merge just to keep busy.
- **Ask the owner first** for migrations, deleting user data, force-pushes and repo settings.

## Design

**Read `DESIGN.md` before any visual or UI decision.** It records the colour system,
the type stack, the touch-target rule and the reasoning behind them. Two points are
easy to get wrong:

- `--primary` (#FF6B6B) and `--secondary` (#00B4A6) are **decoration only**: they fail
  WCAG AA as text at every size. Text, and fills under white labels, use
  `--primary-ink` / `--secondary-ink`.
- That inverts on dark surfaces: on `--navy` the bright token passes and the ink token
  fails. Never blanket-swap a colour token without checking for dark surfaces.

Coral primary buttons are a known, accepted AA exception; see DESIGN.md before
"fixing" them. Colours always come from the CSS variables in `app/globals.css`.

## Internationalization

- Pages live under `app/[locale]/`. The locale list is in `lib/i18n/routing-config.ts`;
  `Link`, `redirect`, `useRouter` and `usePathname` come from `@/lib/i18n/routing`;
  request config is `i18n.ts`; locale detection is in `middleware.ts`.
- Strings live in `messages/{en,es,it,pt}/<namespace>.json`, with the same keys in all
  four files. Never hardcode user-facing text, including in config arrays (store a
  `labelKey` and call `t(option.labelKey)`).
- Server components use `getTranslations()`; client components use `useTranslations()`.
- Use ICU for plurals and variables: `"{count, plural, =1 {1 item} other {# items}}"`.
- AI output follows the user's language through the language instruction in
  `lib/gemini.ts`; cached AI content is stored per language.
- After adding strings, open the page in `/es`, `/it` and `/pt` as well as English.
- Visitors also read us through their browser's translator, which swaps text nodes for
  `<font>`. `lib/platform/survive-page-translators.ts` keeps the page up, but text React
  changes in place stays in the old words. Where the words change with a step or a mode,
  put a `key` on the element (see `components/wizard/WizardFooter.tsx`).

## SEO and server rendering (MANDATORY)

Googlebot indexes the **initial server HTML**, not the DOM a browser builds after
JavaScript runs. A page whose content or links only appear client-side is treated as
thin and left unindexed. Verify every new public page:

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
curl -sL --compressed --max-time 30 -A "$UA" "https://monkeytravel.app/<path>" -o /tmp/p.html
grep -ocE '<h1|<h2|<h3' /tmp/p.html                          # headings present
grep -oc '<a [^>]*href' /tmp/p.html                          # ≥ 30 links on indexable pages
grep -oE '<html[^>]*lang="[a-z-]+"' /tmp/p.html              # matches the URL locale
grep -oE '<link rel="canonical" href="[^"]+"' /tmp/p.html    # self-referencing per locale
grep -oE '<link rel="alternate" hrefLang' /tmp/p.html | wc -l
grep -oE '<meta name="robots" content="[^"]+"' /tmp/p.html   # index for public pages only
```

The traps that have broken indexing before:

1. **Client wrappers that start in a loading state.** A `"use client"` wrapper that
   shows a spinner until an effect finishes serves that spinner to crawlers on every
   page. Render children eagerly and switch to a blocking view only when a check
   decides to block; for auth or maintenance gates prefer middleware or a server-side
   check. Also keep the wrapper's element tree the same shape before and after the
   check, or every descendant remounts and flashes.
2. **Client siblings pulling server content into the RSC stream.** Put server-rendered
   content first and wrap client siblings in `<Suspense fallback={null}>`, as
   `BlogContent` does.
3. **Client-only navbar or footer.** They carry the sitewide link graph, so they are
   server components with small `*Client.tsx` islands for interactivity. New sitewide
   layout components default to server.
4. **Async server components inside client trees** fail the build. Keep a server
   `Foo.tsx` for public pages and a `FooClient.tsx` for client trees.
5. **`Link` from `@/lib/i18n/routing` is a client component.** The `<a href>` still
   renders server-side, but its children travel as RSC payload; plain `next/link` avoids
   that where no locale handling is needed. Our `Link` prefetches on hover, focus or
   touch, not on sight; give a plain `next/link` `prefetch={false}` so it does not fetch
   every visible page in the background.
6. **Double brand in titles.** The root layout's template appends `| MonkeyTravel`, so
   titles passed through it must not already end with it.
7. **`<html lang>`** comes from `getLocale()` in the root layout, never a constant.
8. **Private share links stay out of search.** `/shared/<token>` is `noindex, nofollow`
   and in no sitemap. The indexable user content is published trips and creator
   profiles, which have their own sitemaps (`app/sitemap-trips.xml/`,
   `app/sitemap-creators.xml/`).
9. **Sitemap `lastModified`** uses real content dates, never the build time.
10. **Never robots-block a noindexed page.** Google must crawl it to see the noindex;
    a blocked URL stays indexed. `app/robots.ts` blocks only endpoints, auth and
    one-time-token pages (`/api/`, `/auth/`, `/admin`, `/invite/`, `/join/`, ...).

`noindex, nofollow` routes: `[locale]/auth/**` (its layout), `[locale]/trips/**`,
`[locale]/onboarding/**`, `[locale]/shared/[token]` (`generateMetadata`).

Choosing server or client: default to a server component, and extract only the part
that needs state, effects or browser APIs into a `*Client.tsx` island.
`getTranslations()` and the server Supabase client (`@/lib/supabase/server`, which
reads cookies and makes the route dynamic) never go into a `"use client"` file.

## After every push to master (MANDATORY)

Run `./scripts/verify-deploy.sh` (it checks the latest commit on `origin`) and do not
call anything deployed until it exits 0. Vercel keeps serving the previous build when
a new one fails, so production looks fine while your change is not live. Exit codes:
0 success, 1 failed, 2 still pending at timeout, 3 tool problem.

If it fails: reproduce with `npm run build` (the build validates more than `tsc`), fix,
push, and run the script again. For changes that affect server-rendered output, re-run
the curl checks above on production.

## Content sourcing (MANDATORY)

**Every statistic in published content needs a source you have opened and read, or it
does not ship.** That rules out invented figures, figures attributed to a named company
without a source, and citations that point at a homepage or a 404.

- Fetch every cited URL, check the status, and confirm the page contains the claim.
  Read primary sources, not search summaries.
- If a figure cannot be verified, drop the precision and keep the point. Never swap one
  unverified number for another.
- Prefer first-party data with a `*Data:` footer (sample size, date range, privacy
  note), and recompute it before re-dating a post.
- `updatedAt` changes only when the content changed. Fixing a typo or a dead link is
  not a content update.
- Not problems, so leave them alone: ordinary travel-guide ranges ("40-60% cheaper
  than spring"), posts that share a template (measure prose overlap, never judge by
  slug), and batches of posts created on the same day.
- Apply every content fix to all four locales: `content/blog/` and
  `content/blog/{es,it,pt}/`.

```bash
# every external citation, deduplicated
grep -rhoE "\[[^]]*\]\(https?://[^)]*\)" content/blog/ | grep -v monkeytravel | sort -u
# claims attributed to a named company
grep -rnoE "(Skyscanner|Booking\.com|Tripadvisor|Hostelworld|Kayak)[^.]{0,40}(survey|study) found" content/blog/
```

## Traffic numbers (MANDATORY)

Before quoting or reacting to any traffic number, read
`docs/ANALYTICS_SOURCES_OF_TRUTH.md`. In short:

- `page_views_human` (via `page_view_rollup` and the admin RPCs) is the only source for
  how many people visited. Raw `page_views` includes crawlers and automation; GA4 is
  consent-gated and sees a minority sample.
- Search Console (`npx tsx scripts/gsc-daily.mts`) is the independent tie-breaker.
- Compare a day with the previous week's range, not with the day before.
- **Never block or rate-limit bot traffic in response to a number. Label it.**
- Do not change tracking, tags or middleware before following that document.

## Local setup

- Environment variables: copy `.env.example` to `.env.local`. Never print or commit
  secret values.
- `.mcp.json` configures two Supabase MCP servers: `supabase-monkey` is this app's
  production database (project `sevfbahwmlbdlnbhqwyi`); `supabase-rysk` belongs to a
  different project. Check which one you are calling.
- `.envrc.example` documents per-project `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN` for
  direnv, so the CLIs cannot act on the wrong account. `.envrc` is gitignored.
- Manual production deploy, rarely needed: `npx vercel --prod`.

## gstack

This repo uses [gstack](https://github.com/garrytan/gstack), a shared toolkit of Claude
Code skills. Install it once with `git clone --single-branch --depth 1
https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd
~/.claude/skills/gstack && ./setup`.

**Web browsing:** use the **`/browse`** skill for all web browsing, QA and live-site
checks. Do **not** use the `mcp__claude-in-chrome__*` tools.

**Skills** (invoke with `/<name>`): `/office-hours` · `/plan-ceo-review` ·
`/plan-eng-review` · `/plan-design-review` · `/design-consultation` · `/design-shotgun` ·
`/design-html` · `/review` · `/ship` · `/land-and-deploy` · `/canary` · `/benchmark` ·
`/browse` · `/connect-chrome` · `/qa` · `/qa-only` · `/design-review` ·
`/setup-browser-cookies` · `/setup-deploy` · `/setup-gbrain` · `/retro` · `/investigate` ·
`/document-release` · `/document-generate` · `/codex` · `/cso` · `/autoplan` ·
`/plan-devex-review` · `/devex-review` · `/careful` · `/freeze` · `/guard` · `/unfreeze` ·
`/gstack-upgrade` · `/learn`
