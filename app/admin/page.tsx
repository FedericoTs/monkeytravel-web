import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, getAdminName } from "@/lib/admin";
import AdminDashboard from "@/components/admin/AdminDashboard";

export const metadata = {
  title: "Admin Dashboard | MonkeyTravel",
  description: "Platform analytics and performance metrics",
};

export default async function AdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect if not authenticated
  if (!user) {
    redirect("/auth/login?redirect=/admin");
  }

  // Redirect if not admin
  if (!isAdmin(user.email)) {
    redirect("/");
  }

  const adminName = getAdminName(user.email || "");

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <a href="/" className="flex items-center gap-2">
                <img
                  src="/images/logo.png"
                  alt="MonkeyTravel"
                  className="h-8 w-8"
                />
                <span className="font-semibold text-lg text-[var(--foreground)]">
                  MonkeyTravel
                </span>
              </a>
              <span className="text-slate-300">|</span>
              <span className="text-[var(--primary)] font-medium">Admin</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-600">
                Welcome, <span className="font-medium">{adminName}</span>
              </span>
              <a
                href="/trips"
                className="text-sm text-[var(--primary)] hover:underline"
              >
                Back to App
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Dashboard Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AdminDashboard />
      </main>
    </div>
  );
}
