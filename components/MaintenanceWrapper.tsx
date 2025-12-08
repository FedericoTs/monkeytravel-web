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
 * Check if a user is an active test account
 */
async function isTestAccount(supabase: ReturnType<typeof createClient>, email: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("test_accounts")
      .select("id, is_active, expires_at")
      .eq("email", email.toLowerCase())
      .single();

    if (error || !data) return false;

    // Check if account is active
    if (!data.is_active) return false;

    // Check if account has expired
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
  const [checking, setChecking] = useState(true);

  const checkAccess = useCallback(async () => {
    try {
      // Fetch site config
      const configResponse = await fetch("/api/admin/config");
      const siteConfig: SiteConfig = await configResponse.json();
      setConfig(siteConfig);

      // If maintenance mode is off, allow access
      if (!siteConfig.maintenance_mode) {
        setIsBlocked(false);
        setChecking(false);
        return;
      }

      // Check if user is authenticated
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // If not authenticated, block access (they'll see maintenance page)
      if (!user) {
        setIsBlocked(true);
        setChecking(false);
        return;
      }

      // Check if user is admin
      if (isAdmin(user.email)) {
        setIsBlocked(false);
        setChecking(false);
        return;
      }

      // Check if user email is in allowed list
      const allowedEmails = siteConfig.allowed_emails || [];
      if (user.email && allowedEmails.includes(user.email.toLowerCase())) {
        setIsBlocked(false);
        setChecking(false);
        return;
      }

      // Check if user is an active test account
      if (user.email && await isTestAccount(supabase, user.email)) {
        setIsBlocked(false);
        setChecking(false);
        return;
      }

      // User is not admin, not in allowed list, and not a test account - block access
      setIsBlocked(true);
      setChecking(false);
    } catch (error) {
      console.error("Error checking maintenance status:", error);
      // On error, allow access to prevent locking everyone out
      setIsBlocked(false);
      setChecking(false);
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

    if (shouldSkip) {
      setIsBlocked(false);
      setChecking(false);
      return;
    }

    checkAccess();
  }, [pathname, checkAccess]);

  // Show nothing while checking (brief flash)
  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show maintenance page if blocked
  if (isBlocked && config) {
    return (
      <MaintenancePage
        title={config.maintenance_title}
        message={config.maintenance_message}
      />
    );
  }

  // Otherwise render children normally
  return <>{children}</>;
}
