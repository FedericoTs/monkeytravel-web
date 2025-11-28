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
