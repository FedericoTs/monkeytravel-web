"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
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

export default function MaintenanceWrapper({ children }: MaintenanceWrapperProps) {
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
      // Fetch site config
      const configResponse = await fetch("/api/admin/config");
      const siteConfig: SiteConfig = await configResponse.json();
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
