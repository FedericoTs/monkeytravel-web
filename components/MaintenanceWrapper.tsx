"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "@/lib/i18n/routing";
import { useAuth } from "@/components/auth/AuthProvider";
import MaintenancePage from "./MaintenancePage";

interface SiteConfig {
  maintenance_mode: boolean;
  maintenance_title: string;
  maintenance_message: string;
}

interface MaintenanceWrapperProps {
  children: React.ReactNode;
}

/**
 * Site config, fetched at most once per TTL for the whole tab.
 *
 * This wrapper mounts in the locale layout, so it survives client-side
 * navigation and its effect re-ran on every pathname change — one
 * /api/admin/config request per navigation, forever, for every visitor. The
 * config cannot differ per path, so all but the first were redundant.
 *
 * The route already sets `Cache-Control: public, s-maxage=60,
 * stale-while-revalidate=300`, and that IS working — measured on production,
 * repeat requests return `X-Vercel-Cache: HIT` with a rising `Age`, so they are
 * served from the edge without invoking the function or touching Supabase. So
 * this is not the serverless-cost fix it looks like; the waste was a redundant
 * network request per navigation, not a redundant function invocation.
 *
 * TTL matches the route's own s-maxage, so the freshness guarantee is
 * unchanged: a maintenance toggle is still picked up within ~60s of the next
 * navigation, exactly as before.
 */
const CONFIG_TTL_MS = 60_000;
let cachedConfig: SiteConfig | null = null;
let cachedAt = 0;
let inflight: Promise<SiteConfig | null> | null = null;

async function loadSiteConfig(): Promise<SiteConfig | null> {
  if (cachedConfig && Date.now() - cachedAt < CONFIG_TTL_MS) {
    return cachedConfig;
  }
  // Share one request between concurrent callers rather than racing.
  if (inflight) return inflight;

  inflight = fetch("/api/admin/config")
    .then((r) => (r.ok ? (r.json() as Promise<SiteConfig>) : null))
    .then((cfg) => {
      if (cfg) {
        cachedConfig = cfg;
        cachedAt = Date.now();
      }
      return cfg;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export default function MaintenanceWrapper({ children }: MaintenanceWrapperProps) {
  // Locale-aware usePathname: the raw next/navigation one KEEPS the locale
  // prefix, so `pathname.startsWith("/auth/login")` was false on /es, /it and
  // /pt. During maintenance that meant a Spanish or Italian visitor could not
  // reach the login page to sign in — including an admin trying to turn
  // maintenance back off. /privacy and /terms were unreachable on those
  // locales too. This one strips the prefix, so the skip list applies to every
  // locale equally.
  const pathname = usePathname();
  // Task #181 cleanup: read auth state from the single AuthProvider
  // instead of firing our own getUser(). `loading` is used to defer the
  // maintenance check until we actually know whether there's a user —
  // otherwise admins could see a flash of MaintenancePage on first paint.
  const { user, loading: authLoading } = useAuth();
  const [isBlocked, setIsBlocked] = useState(false);
  const [config, setConfig] = useState<SiteConfig | null>(null);

  const checkAccess = useCallback(async () => {
    try {
      const siteConfig = await loadSiteConfig();

      // Fail open. A config we cannot read must never lock everyone out.
      if (!siteConfig) {
        setIsBlocked(false);
        return;
      }
      setConfig(siteConfig);

      // If maintenance mode is off, allow access
      if (!siteConfig.maintenance_mode) {
        setIsBlocked(false);
        return;
      }

      // If not authenticated, block access (they'll see maintenance page)
      if (!user) {
        setIsBlocked(true);
        return;
      }

      // Admin / allowed-list / tester bypass is computed SERVER-SIDE so the
      // admin email allowlist never ships in the client bundle (this wrapper
      // mounts in the root layout, i.e. every page). Only reached when
      // maintenance_mode is on, so the extra request is rare.
      const bypassResponse = await fetch("/api/auth/maintenance-bypass", {
        credentials: "include",
        cache: "no-store",
      });
      const bypassJson = await bypassResponse.json().catch(() => ({}));
      const bypass = Boolean(
        bypassJson?.data?.bypass ?? bypassJson?.bypass,
      );

      setIsBlocked(!bypass);
    } catch (error) {
      console.error("Error checking maintenance status:", error);
      // On error, allow access to prevent locking everyone out
      setIsBlocked(false);
    }
  }, [user]);

  useEffect(() => {
    // Skip maintenance check for certain paths
    const skipPaths = [
      "/auth/login",
      "/auth/signup",
      "/auth/callback",
      "/auth/signout",
      "/api/",
      "/admin",
      "/privacy",
      "/terms",
    ];

    const shouldSkip = skipPaths.some(path => pathname.startsWith(path));
    if (shouldSkip) return;

    // Wait for the central AuthProvider to resolve before deciding — otherwise
    // we'd treat the brief pre-hydration window as "no user" and block admins.
    if (authLoading) return;

    checkAccess();
  }, [pathname, checkAccess, authLoading]);

  // Render children by default — Googlebot and the first paint both get full
  // page content immediately. The async maintenance check runs in useEffect; if
  // it determines this user should be blocked, we swap to MaintenancePage on the
  // next render. This keeps SSR HTML crawl-friendly (zero blank-spinner pages
  // delivered to bots) and only adds a brief flash for the rare case when
  // maintenance mode is actually on for a non-admin user.
  if (isBlocked && config) {
    return (
      <MaintenancePage
        title={config.maintenance_title}
        message={config.maintenance_message}
      />
    );
  }

  return <>{children}</>;
}
