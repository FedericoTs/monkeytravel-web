import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  // All supported locales
  locales: ["en", "es", "it", "pt"],

  // Default locale (no URL prefix)
  defaultLocale: "en",

  // Only add locale prefix for non-default locales
  localePrefix: "as-needed",

  // NEXT_LOCALE was being written without `Secure`, so it would have been sent
  // over plain http had anything ever reached the site that way. Production is
  // https-only (HSTS preload), so gating on NODE_ENV costs nothing and keeps
  // localhost working — a Secure cookie is silently dropped on http, which
  // would break locale switching in dev.
  //
  // `httpOnly` is intentionally absent, and next-intl does not offer it: the
  // language switcher writes this cookie from the client
  // (components/LanguageSwitcher.tsx), so HttpOnly would break switching. It
  // stores a UI language, not a credential — there is nothing in it to steal.
  // The real session cookies are already HttpOnly + Secure + SameSite=Lax
  // (lib/supabase/middleware.ts) and were never affected.
  localeCookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
});

// Navigation helpers that handle locale automatically
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
