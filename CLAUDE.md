# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Backend**: Supabase (auth, database, storage)
- **Fonts**: Geist Sans and Geist Mono via next/font

## Brand Colors

Defined in `app/globals.css`:
- **Primary**: `#0A4B73` (dark blue) - `var(--primary)`
- **Accent**: `#F2C641` (golden yellow) - `var(--accent)`
- Use CSS variables for all colors to maintain consistency

## Project Structure

- `app/` - Next.js App Router pages and layouts
- `components/` - Reusable UI components
- `lib/supabase.ts` - Supabase client instance
- `public/images/` - Static assets

## Components

Reusable UI components in `components/`:
- `Navbar.tsx` - Fixed navigation with mobile menu
- `Button.tsx` - Multi-variant button (primary, secondary, accent, outline, ghost)
- `Badge.tsx` - Pill-style labels (default, accent, success, outline)
- `PhoneMockup.tsx` - CSS-based iPhone mockup with placeholder screen
- `FeatureCard.tsx` - Feature showcase cards with icons
- `TestimonialCard.tsx` - Review cards with star ratings
- `StoreButton.tsx` - App Store / Play Store download buttons
- `Footer.tsx` - Full footer with newsletter, links, social icons

## Design Patterns

- All colors use CSS variables from globals.css
- Components use Tailwind with `var(--color-name)` pattern
- Animation classes: `animate-float`, `animate-pulse-glow`
- Background patterns: `bg-grid-pattern`, `gradient-warm`, `gradient-primary`

## Supabase

```typescript
import { supabase } from '@/lib/supabase'
```

Environment variables in `.env.local` with `NEXT_PUBLIC_` prefix for client-side access.
