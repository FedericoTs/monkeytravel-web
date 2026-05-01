"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isAdmin } from "@/lib/admin";
import MaintenancePage from "./MaintenancePage";

interface SiteConfig {
  maintenance_mode: boolean;
  maintenance_title: string;
  maintenance_message: string;
  allowed_emails: string[];
}

interface MaintenanceWrapperProps {
  children: React.ReactNode;
}

/**
 * Check if a user has valid tester access (redeemed an early access code)
 */
async function hasValidTesterAccess(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_tester_access")
      .select("id, expires_at")
      .eq("user_id", userId)
      .single();

    if (error || !data) return false;

    // Check if access has expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) return false;

    return true;
  } catch {
    return false;
  }
}

export default function MaintenanceWrapper({ children }: MaintenanceWrapperProps) {
  const pathname = usePathname();
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

      // Check if user is authenticated
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // If not authenticated, block access (they'll see maintenance page)
      if (!user) {
        setIsBlocked(true);
        return;
      }

      // Check if user is admin
      if (isAdmin(user.email)) {
        setIsBlocked(false);
        return;
      }

      // Check if user email is in allowed list
      const allowedEmails = siteConfig.allowed_emails || [];
      if (user.email && allowedEmails.includes(user.email.toLowerCase())) {
        setIsBlocked(false);
        return;
      }

      // Check if user has redeemed an early access code
      if (await hasValidTesterAccess(supabase, user.id)) {
        setIsBlocked(false);
        return;
      }

      // User is not admin, not in allowed list, and has no early access - block
      setIsBlocked(true);
    } catch (error) {
      console.error("Error checking maintenance status:", error);
      // On error, allow access to prevent locking everyone out
      setIsBlocked(false);
    }
  }, []);

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

    checkAccess();
  }, [pathname, checkAccess]);

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
