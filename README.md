# MonkeyTravel

An AI trip planner: describe a trip, get a day-by-day plan, refine it with the
assistant, and plan it together with the people coming. Live at
[monkeytravel.app](https://monkeytravel.app).

## Stack

- [Next.js](https://nextjs.org) 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- [Supabase](https://supabase.com): Postgres with row-level security, auth; schema in `supabase/migrations`
- Gemini for trip generation and the assistants (`lib/ai`)
- [next-intl](https://next-intl.dev) in English, Spanish, Italian and Portuguese (`messages/`)
- Vercel for hosting and crons (`vercel.json`), Resend for email, PostHog and Sentry

## Getting started

Node 24 and npm 11 (npm 11 writes `package-lock.json`).

```bash
npm ci
cp .env.example .env.local
npm run dev
```

`.env.example` lists the feature flags. The app also needs:

| Variable | For |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side writes that row-level security doesn't allow a user |
| `GOOGLE_AI_API_KEY` | Gemini |
| `GOOGLE_PLACES_API_KEY` | places and photos |
| `RESEND_API_KEY` | email |
| `CRON_SECRET` | the cron routes under `app/api/cron` |
| `NEXT_PUBLIC_APP_URL` | absolute links in emails and shares |

A local server uses whichever Supabase project `.env.local` points at: with
production keys, what you do locally writes production data.

## Checks

| Command | Runs |
|---|---|
| `npm run typecheck` | TypeScript over the app and the tests |
| `npm run lint` | ESLint. CI fails on an error, or on more warnings than the ceiling in `.github/workflows/ci.yml` |
| `npm test` | Vitest: unit, route and guard tests (`*.vitest.ts`) |
| `npm run test:e2e` | Playwright (`tests/e2e`) |

CI runs the public-page E2E specs on every pull request. The signed-in specs
run against a server you start, with seeded fixtures and a saved sign-in:
`npm run e2e:fixtures -- --seed`, then `npm run e2e:login`; each spec's header
says what it needs. `npm run e2e:fixtures -- --teardown` removes the fixtures.

## Layout

| Path | Holds |
|---|---|
| `app/[locale]/` | pages, per language |
| `app/api/` | API routes. A route file exports only its handlers and segment config (`app/route-exports.vitest.ts`) |
| `components/`, `hooks/` | UI and React hooks |
| `lib/` | the logic behind them: `lib/ai` (generation, assistants), `lib/trips` (saving, sharing), `lib/wizard`, `lib/notifications`, … |
| `messages/<locale>/` | translation catalogs |
| `supabase/migrations/` | database schema and policies |
| `scripts/` | maintenance, audit and content scripts, run through `npm run …` or `npx tsx` |
| `docs/` | design notes and plans |

## Conventions

- One concern per pull request. A merge to `master` deploys to production.
- Comments describe the code as it is now: no dates or incident stories.
- User-facing text lives in `messages/`, in all four languages.
