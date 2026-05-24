import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NotificationPreferencesClient from "./NotificationPreferencesClient";

export const metadata = {
  title: "Notification Preferences | MonkeyTravel",
  description: "Manage which emails and in-app notifications you receive.",
  robots: { index: false, follow: false },
};

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
export default async function NotificationPreferencesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/profile/notifications");
  }

  return <NotificationPreferencesClient />;
}
