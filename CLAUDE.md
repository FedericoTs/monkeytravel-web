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
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

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
