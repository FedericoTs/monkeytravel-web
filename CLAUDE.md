# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MonkeyTravel** - AI-powered travel planning app landing page and waitlist.

- **Live URL**: https://monkeytravel.app
- **GitHub**: https://github.com/FedericoTs/monkeytravel-web
- **Vercel Project**: travel-app-web

## Commands

```bash
npm run dev      # Start development server (http://localhost:3000)
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Backend**: Supabase (database)
- **Hosting**: Vercel
- **Fonts**: Geist Sans and Geist Mono via next/font

## Brand Colors

Defined in `app/globals.css`:
- **Primary**: `#0A4B73` (dark blue) - `var(--primary)`
- **Accent**: `#F2C641` (golden yellow) - `var(--accent)`
- **Navy**: `#0f172a` (dark navy for footer/CTA)
- Use CSS variables for all colors to maintain consistency

## Project Structure

```
app/
├── api/subscribe/route.ts  # Email subscription API endpoint
├── layout.tsx              # Root layout with metadata
├── page.tsx                # Main landing page
├── privacy/page.tsx        # Privacy Policy
├── terms/page.tsx          # Terms of Service
└── globals.css             # Global styles, CSS variables

components/
├── Navbar.tsx              # Fixed navigation with mobile menu
├── Footer.tsx              # Dark navy footer with links
├── EmailSubscribe.tsx      # Email capture form (hero/dark variants)
├── PhoneMockup.tsx         # iPhone mockup with screenshot support
├── Badge.tsx               # Pill-style labels
├── Button.tsx              # Multi-variant button
├── FeatureCard.tsx         # Feature showcase cards
├── TestimonialCard.tsx     # Review cards with star ratings
└── StoreButton.tsx         # App Store / Play Store buttons

lib/
└── supabase.ts             # Supabase client instance

public/
├── images/logo.png         # MonkeyTravel logo
└── screenshots/            # App screenshots for phone mockups
```

## Key Features

### Email Subscription System

The waitlist form saves emails to Supabase:

```typescript
// API endpoint: POST /api/subscribe
// Body: { email: string, source: string }
// Response: { message: string, id?: string }
```

Database table: `email_subscribers`
- `email` (unique, validated)
- `source` (hero, cta, footer)
- `subscribed_at`
- `metadata` (user agent, referer, timestamp)

### Screenshot Configuration

Replace phone mockup placeholders with real screenshots in `app/page.tsx`:

```typescript
const APP_SCREENSHOTS = {
  hero: '/screenshots/home-screen.png',        // or undefined for placeholder
  preview: {
    left: '/screenshots/discover.png',
    center: '/screenshots/itinerary.png',
    right: '/screenshots/trip-detail.png',
  },
};
```

Recommended size: 1170 x 2532 pixels (iPhone 14 Pro)

### EmailSubscribe Component

```tsx
<EmailSubscribe
  variant="hero"           // 'hero' | 'dark' | 'footer' | 'inline'
  source="hero"            // tracking source for analytics
  className="mb-6"
/>
```

## Design Patterns

- All colors use CSS variables from globals.css
- Components use Tailwind with `var(--color-name)` pattern
- Animation classes: `animate-float`, `animate-pulse-glow`
- Background patterns: `bg-grid-pattern`, `gradient-warm`, `mesh-gradient`
- Glassmorphism: `glass` class for frosted glass effect
- Gradient text: `gradient-text`, `gradient-text-blue`

## Environment Variables

Required in `.env.local` and Vercel:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# PostHog (Analytics, Feature Flags, A/B Testing)
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

## PostHog (Analytics & Feature Flags)

PostHog provides analytics, feature flags, and A/B testing.

### Architecture (Next.js 15.3+)

PostHog is initialized in `instrumentation-client.ts` using the official Next.js pattern:

```
instrumentation-client.ts  # PostHog + Sentry init (auto-loaded by Next.js)

lib/posthog/
├── client.ts      # PostHog instance export + legacy init fallback
├── server.ts      # Server-side (API routes, RSC)
├── identify.ts    # User identification
├── events.ts      # Type-safe event capture
├── flags.ts       # Feature flag definitions
├── hooks.ts       # React hooks (useFlag, useExperiment)
└── index.ts       # Main exports
```

### Usage Examples

**Feature Flags:**
```tsx
import { useFlag, useExperiment } from '@/lib/posthog'

function Component() {
  const { enabled } = useFlag('new-feature')
  const { variant } = useExperiment('pricing-test')

  return enabled ? <NewFeature /> : <OldFeature />
}
```

**Event Tracking:**
```tsx
import { captureTripCreated } from '@/lib/posthog/events'

captureTripCreated({
  trip_id: tripId,
  destination: 'Paris',
  duration_days: 5,
  budget_tier: 'balanced',
})
```

**User Identification:**
```tsx
import { identifyUser } from '@/lib/posthog'

identifyUser(user, {
  subscription_tier: 'free',
  trips_created: 3,
})
```

### Current Experiments

| Flag | Purpose |
|------|---------|
| `share-modal-delay` | Test modal timing (immediate/delayed/on-scroll) |
| `pricing-tier-test` | Test price points ($29/$39/$49) |
| `trial-duration` | Test trial length (3/7/14 days) |

## MCP Servers

This project uses MCP servers for AI-assisted development:

- **Supabase MCP**: Database management, migrations, queries
- **Vercel MCP**: Deployment, domain management

## Deployment

Auto-deploys from `master` branch via Vercel GitHub integration.

Manual deploy:
```bash
npx vercel --prod
```

## Supabase

```typescript
import { supabase } from '@/lib/supabase'

// Example: Insert email subscriber
const { data, error } = await supabase
  .from('email_subscribers')
  .insert({ email, source, metadata })
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main landing page with waitlist |
| `/privacy` | Privacy Policy (App Store requirement) |
| `/terms` | Terms of Service (App Store requirement) |
| `/api/subscribe` | POST endpoint for email subscription |

## Internationalization (i18n)

> **MANDATORY**: All new features MUST be built with translations from the start.
> Never hardcode user-facing strings. Use translation keys immediately.

MonkeyTravel supports multiple languages using `next-intl`:

### Supported Languages
- **English** (default) - no URL prefix (`/`)
- **Spanish** - URL prefix `/es/*`
- **Italian** - URL prefix `/it/*`

### File Structure

```
i18n.ts                    # Main i18n configuration
lib/i18n/routing.ts        # Locale routing config
middleware.ts              # Locale detection middleware
app/[locale]/              # All pages under locale dynamic route

messages/
├── en/                    # English translations
│   ├── common.json        # Shared UI strings
│   ├── auth.json          # Auth forms and errors
│   ├── trips.json         # Trip wizard strings
│   ├── landing.json       # Landing page copy
│   └── profile.json       # Profile page strings
├── es/                    # Spanish translations
│   └── (same structure)
└── it/                    # Italian translations
    └── (same structure)
```

### How to Add Translations

**1. Server Components (async functions):**
```tsx
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('landing');

  return <h1>{t('hero.title')}</h1>;
}
```

**2. Client Components ('use client'):**
```tsx
'use client';
import { useTranslations } from 'next-intl';

export default function Component() {
  const t = useTranslations('common');

  return <button>{t('save')}</button>;
}
```

### Adding New Translations

1. Add keys to all language files (`messages/{en,es,it}/namespace.json`)
2. Use `t('key.path')` in components
3. For nested keys: `t('hero.trustSignals.free')`

### Translation File Example

```json
// messages/en/landing.json
{
  "hero": {
    "title": "The AI Travel Planner That Actually Works",
    "subtitle": "Drop a destination. Get a personalized itinerary.",
    "cta": "Plan My Trip Free"
  }
}

// messages/it/landing.json
{
  "hero": {
    "title": "Il Pianificatore di Viaggi con IA Che Funziona Davvero",
    "subtitle": "Scegli una destinazione. Ottieni un itinerario personalizzato.",
    "cta": "Pianifica il Mio Viaggio Gratis"
  }
}
```

### AI Content Localization

AI-generated itineraries are localized via language instruction in `lib/gemini.ts`:

```typescript
// The AI receives language instructions to respond in the user's locale
function getLanguageInstruction(language: 'en' | 'es' | 'it'): string {
  // Returns Spanish/Italian instruction for non-English locales
}
```

### Database Schema

```sql
-- User's preferred UI language
users.preferred_language TEXT DEFAULT 'en' CHECK (preferred_language IN ('en', 'es', 'it'))

-- Cache entries are language-specific
destination_activity_cache.language VARCHAR(5) DEFAULT 'en'
```

### Best Practices

1. **Always use translation keys** - Never hardcode user-facing strings
2. **Namespace by feature** - Use `common.json` for shared strings, feature-specific files otherwise
3. **Test all locales** - Visit `/es` and `/it` after adding translations
4. **Keep keys consistent** - Same key structure across all language files

### Development Rules (MANDATORY)

When creating any new component or feature:

1. **Start with translation keys** - Before writing any UI text, add keys to all 3 language files
2. **Use the pattern**:
   ```tsx
   // Client component
   const t = useTranslations("common.featureName");
   return <h1>{t("title")}</h1>;

   // Server component
   const t = await getTranslations("common.featureName");
   ```
3. **For config-driven UI** (arrays, options):
   ```tsx
   // WRONG - hardcoded text
   const OPTIONS = [{ label: "Option 1" }];

   // CORRECT - translation keys
   const OPTIONS = [{ labelKey: "option1" }];
   // Then: {t(option.labelKey)}
   ```
4. **Always add to ALL 3 files** - `en`, `es`, and `it` must have the same keys
5. **ICU format for plurals/variables**:
   ```json
   {
     "items": "{count, plural, =1 {1 item} other {# items}}"
   }
   ```

### Admin Translation Editor

Admins can edit translations at `/admin/translations`:
- View all translation keys across languages
- Edit values inline
- Search by key or value
- Changes are saved to JSON files immediately

### AI Response Language

The AI generates content in the user's selected language:
- `lib/gemini.ts` contains `getLanguageInstruction()`
- Append language instruction to prompts for non-English locales
- Activity descriptions, tips, and summaries are localized

## SEO & SSR Discipline (MANDATORY)

> **Why this section exists**: in April 2026 we discovered ~75 URLs stuck in
> Google Search Console's "Discovered — currently not indexed" cohort and ~80
> in "Crawled — currently not indexed". Root cause: server-side HTML delivered
> to Googlebot was a blank loading spinner with zero internal links, even
> though every page rendered fine in the browser. Several traps below all had
> to be hit at once. Every new feature must respect these rules.

### Crawler-Visible HTML — the only thing that matters for indexing

Googlebot's first-pass crawl reads the **initial SSR HTML response**. It does
NOT execute JavaScript on every URL. If your page's important content (text
headings, internal links, article body) is not in that initial HTML, Google
treats the page as thin/empty and parks it in "Discovered/Crawled — not
indexed". The browser DevTools "view rendered DOM" is a LIE for SEO purposes —
only the raw HTTP response counts.

**Verify any new page with this curl recipe before considering it shipped:**

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
curl -sL --compressed --max-time 30 -A "$UA" "https://monkeytravel.app/<path>" -o /tmp/p.html

# Structural HTML present?
grep -ocE '<h1|<h2|<h3' /tmp/p.html        # expect ≥ 1 each
grep -oc '<a [^>]*href' /tmp/p.html         # expect ≥ 30 on indexable pages
grep -oc '<footer' /tmp/p.html              # expect 1 (sitewide footer)

# Locale signals correct?
grep -oE '<html[^>]*lang="[a-z-]+"' /tmp/p.html       # must match URL locale
grep -oE '<link rel="canonical" href="[^"]+"' /tmp/p.html  # must be self-referential per locale
grep -oE '<link rel="alternate" hrefLang' /tmp/p.html | wc -l  # expect 4 (en/es/it/x-default)

# Indexability correct?
grep -oE '<meta name="robots" content="[^"]+"' /tmp/p.html
# - public pages: "index, follow"
# - auth/admin/shared: "noindex, nofollow"
```

If `<h2>` count is 0 or `<a href>` count is < 20 on a page meant to rank, the
page tree is being delivered via React Server Components streaming chunks
instead of static HTML. Diagnose with the rules below.

### The traps that bit us — never repeat them

#### Trap 1: Client wrappers with `checking=true` initial state

A client component (`"use client"`) that returns `<Spinner />` while
`checking` is true and renders `children` only after a `useEffect` async
check **delivers a blank spinner to crawlers on every page**. We had this in
`MaintenanceWrapper` for months. Pattern that broke us:

```tsx
// 🚫 SSR-poisoning pattern — every page becomes a spinner for Googlebot
const [checking, setChecking] = useState(true);
useEffect(() => { fetch('/api/...').then(...).finally(() => setChecking(false)); }, []);
if (checking) return <Spinner />;
return <>{children}</>;
```

```tsx
// ✅ Render children eagerly; transition state only when blocking is needed
const [isBlocked, setIsBlocked] = useState(false);
useEffect(() => { fetch('/api/...').then(r => { if (r.shouldBlock) setIsBlocked(true); }); }, []);
if (isBlocked) return <BlockingPage />;
return <>{children}</>;
```

Any wrapper that gates SSR output on a client-side check is suspect. If you
need to block content (auth, maintenance, geo-restriction) prefer:
1. **Middleware** (runs on every request, before render — can redirect/rewrite)
2. **Server-side check in a layout/page** (read cookies/session in a server
   component and conditionally render or redirect)
3. **Eager-render client wrapper** (default to children, swap to blocking UI
   only when an async check decides to block — accepts a brief flash for the
   rare blocking case in exchange for SEO-correct first paint)

#### Trap 2: Server component wrapping client siblings — RSC streaming pollution

When a page tree mixes server and client components, large parts of the tree
can stream via `__next_f.push(...)` chunks instead of being emitted as
static HTML. The blog article body (`<article class="blog-prose">`) was
absent from initial HTML for weeks because `<BlogContentClient>` (a client
sibling of the article inside `<BlogContent>`) pulled the article into the
streaming bucket.

**Pattern fix:** put server-rendered content **first**, wrap the client
sibling in `<Suspense fallback={null}>`:

```tsx
// ✅ Server component — article emits in static HTML, client child is isolated
import { Suspense } from "react";
export default function BlogContent({ html }) {
  return (
    <>
      <article className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />
      <Suspense fallback={null}>
        <BlogContentClient html={html} />  {/* "use client" sibling */}
      </Suspense>
    </>
  );
}
```

#### Trap 3: Client `Navbar` / `Footer` — sitewide PageRank starvation

`Navbar` and `Footer` are on every page. If they're `"use client"`, every
page sitewide loses the internal link graph for crawlers. We restructured
both as **server-with-client-islands**:

- `Navbar.tsx` (server) — renders the `<nav>` shell with all primary links
  in static HTML
- `NavbarClient.tsx` (client island) — handles auth state, mobile menu
  toggle, scroll-based background
- `Footer.tsx` (server) — renders all sitewide links, plus a "Popular
  Destinations" + "Featured Articles" section that emits ~14 internal links
  to top content on every page (sitewide PageRank multiplier)
- `CookieSettingsButton` — small client island imported normally inside the
  server Footer (this is fine; client components CAN render inside server
  parents)

When you create a new sitewide layout component, default to **server**.
Extract the interactive bits into named `*Client.tsx` islands and import
them as small leaves of the server tree.

#### Trap 4: Server async component imported by a client tree

`CuratedEscapes` was made an async server component for SEO, but
`TripsPageClient` (a `"use client"` component) also imported it for the
authenticated dashboard. The Vercel build failed because async components
cannot be rendered inside client trees. **Solution:** keep two variants —
`Foo.tsx` (server, used by public pages) and `FooClient.tsx` (client, used
by client trees). Document which is which in a JSDoc comment.

#### Trap 5: `next-intl` `Link` is a client component

`Link` from `@/lib/i18n/routing` is a client component (it depends on
`createNavigation`'s client hooks). Wrapping a region of a server component
in this `Link` does NOT poison the server render — Next.js still emits
the `<a href>` in static HTML — but it does mean the link's children are
delivered as RSC payload. For pure SSR-link emission with no client
interactivity, plain `next/link` works too and avoids any streaming concern.

#### Trap 6: Title template double-brand

Root layout sets `title.template = "%s | MonkeyTravel"`. If a child page's
metadata returns `title: "Foo | MonkeyTravel"`, the template appends
" | MonkeyTravel" again, producing `Foo | MonkeyTravel | MonkeyTravel` in
the rendered title. Always strip any `| MonkeyTravel` suffix from values
that flow through the template (translations, dynamic titles).

#### Trap 7: `<html lang>` hardcoded in root layout

The root layout (`app/layout.tsx`) is the only component that can render
`<html>`. It doesn't know the URL locale unless told. Use:

```tsx
import { getLocale } from "next-intl/server";
export default async function RootLayout({ children }) {
  const locale = await getLocale();
  return <html lang={locale}>...</html>;
}
```

#### Trap 8: User-generated `/shared/{uuid}` flooding the sitemap

Public sitemaps must list only canonical, evergreen pages. UGC like trip
shares should be `noindex, nofollow` and excluded from `app/sitemap.ts`.
We had ~6 trip-share URLs in the sitemap actively dragging site-quality
score for the rest of the property. `public/robots.txt` should also
`Disallow: /shared/` for belt-and-braces.

#### Trap 9: Sitemap `lastModified: new Date()` on every entry

If every URL's `lastmod` is the build date, you're telling Google "the
entire site changed at once, every build, please ignore the lastmod
signal". Use **realistic dates**: hardcoded constants per content type
(static pages, landing pages), the post's `updatedAt` for blogs, and the
newest post's date for the blog index.

### noindex routes — keep this list current

| Route | `robots: { index: false, follow: false }` |
|---|---|
| `/[locale]/auth/**` | ✅ via `app/[locale]/auth/layout.tsx` |
| `/[locale]/trips/**` | ✅ via `app/[locale]/trips/page.tsx` |
| `/[locale]/onboarding/**` | ✅ via `app/[locale]/onboarding/layout.tsx` |
| `/[locale]/shared/[token]` | ✅ via `generateMetadata` |
| `/admin/**` | (not under [locale]; not crawled per `robots.txt`) |

`public/robots.txt` should `Disallow: /admin`, `/api/`, `/auth/callback`,
`/shared/`.

### When to spin up the Server vs Client checklist

For any new page or component:

1. Does it need `useState` / `useEffect` / browser APIs / event handlers?
   - **No** → server component (default).
   - **Yes** → consider whether the *whole* component needs client, or just
     a small bit. Extract the interactive part as `*Client.tsx`.

2. Will it render on a public/indexable page?
   - **Yes** → must emit its content in static SSR HTML. Verify with the
     curl recipe above.
   - **No (auth/admin/UGC)** → set `robots: { index: false, follow: false }`
     in metadata.

3. Does it use `getTranslations()`?
   - That's a server-only API — fine in server components, will fail in
     client components. Use `useTranslations()` in client components.

4. Does it use Supabase server client (`createClient` from
   `@/lib/supabase/server`)?
   - Forces dynamic rendering (uses `cookies()`).
   - Cannot be imported into a `"use client"` component (async server only).
   - Build will fail if you try.

### Post-deploy verification

A weekly health-check routine (`trig_01Q8z36rfyz9S8jbxQtYLwWe`) runs every
Monday 09:00 UTC and validates the curl recipe across 5 representative URLs
plus the `/shared/{uuid}` noindex check and sitemap hygiene. If you ship
changes that affect SSR output, manually re-run the recipe before declaring
done.
