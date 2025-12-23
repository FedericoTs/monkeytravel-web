import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  // All supported locales
  locales: ["en", "es", "it"],

  // Default locale (no URL prefix)
  defaultLocale: "en",

  // Only add locale prefix for non-default locales
  localePrefix: "as-needed",
});

// Navigation helpers that handle locale automatically
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
