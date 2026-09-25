import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import NotificationPreferencesClient from "./NotificationPreferencesClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile.notificationSettings" });
  return {
    // Strip brand suffix — root layout's title.template adds it.
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: false, follow: false },
  };
}

/**
 * Notification preferences page. Server component does the auth gate;
 * actual UI is in the client component which reads/writes notification_settings
 * via the existing /api/profile PATCH endpoint.
 *
 * Reached from:
 *   - Navbar bell dropdown "View all settings" link
 *   - "Manage preferences" footer in every email
 *   - Direct nav to /profile/notifications
 */
export default async function NotificationPreferencesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // `redirect` is the parameter the login page reads. It used to get
    // `next`, which it ignores, so signed-out readers of an email's "Manage
    // preferences" link signed in and landed on My Trips instead of here.
    const localePrefix = locale === "en" ? "" : `/${locale}`;
    redirect(`${localePrefix}/auth/login?redirect=${encodeURIComponent("/profile/notifications")}`);
  }

  return <NotificationPreferencesClient />;
}
