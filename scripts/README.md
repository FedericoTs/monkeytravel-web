# scripts/

Operational scripts for the monkeytravel-web project.

---

## Deploy verification — MANDATORY after every push to master

Cycle-5 shipped an SSR-500 to production because the deploy pipeline reported
"success" while every React-rendered route was throwing at request time
(`useContext` returned `undefined` in `SessionTracker` because `AuthProvider`
lived under `app/[locale]/layout.tsx`, not `app/layout.tsx`). Neither
`next build` nor `tsc --noEmit` caught it — only a live HTTP probe does.

Run BOTH of these in order after every `git push origin master`:

### 1. `verify-deploy.sh` — wait for Vercel to finish

```bash
bash scripts/verify-deploy.sh
```

Polls the GitHub statuses API until Vercel reports success/failure for the
latest commit. Exits 0 when the build is live. Do not declare "deployed"
without this returning 0.

### 2. `verify-deploy-smoke.sh` / `verify-deploy-smoke.ts` — probe prod routes

```bash
# Bash (Linux/macOS/Git Bash):
bash scripts/verify-deploy-smoke.sh

# Cross-platform (Windows PowerShell, anywhere with Node 18+):
npm run verify:deploy
# equivalent to: tsx scripts/verify-deploy-smoke.ts
```

Hits 9 critical routes via `curl`/`fetch` with a 10s timeout and prints a
status table:

| Route | What it catches |
|---|---|
| `/` | Homepage SSR (Next root layout + AuthProvider boundary) |
| `/blog` | MDX index — frontmatter pipeline + revalidate config |
| `/it`, `/es` | Locale roots — middleware redirect + next-intl |
| `/it/explore` | UGC feed — heavy SSR + DB-backed page |
| `/it/backpacker` | Paid landing — affiliate CTA path |
| `/api/health` | API route + lightweight server-side path |
| `/robots.txt` | Non-React static-y route (app/robots.ts) |
| `/sitemap.xml` | Next-generated route, sanity check |

Exits 0 if every route returns 2xx or 3xx. Exits 1 on any 4xx/5xx/timeout.
**SMOKE FAIL after a green CI is a regression** — investigate before
declaring the deploy good.

### Override the target URL

Both scripts accept a base URL arg for local-dev or preview probing:

```bash
bash scripts/verify-deploy-smoke.sh http://localhost:3000
tsx scripts/verify-deploy-smoke.ts https://monkeytravel-pr-123.vercel.app
```

---

## Other scripts (not deploy-critical)

See individual script headers for usage. Highlights:

- `backup-vercel-project.sh` — snapshot env + project config
- `audit-gemini-costs.mjs` — Gemini API spend audit
- `test-ai-costs.ts` — AI provider cost dry-run
- `capture-app-screens.ts` — Playwright-based marketing screenshots
- `refresh-visa-data.mjs` — nightly visa-matrix refresh (also runs via cron)
- `render-video.ts` — Remotion render
