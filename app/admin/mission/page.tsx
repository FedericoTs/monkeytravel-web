import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";
import { MissionControl, type MissionData } from "@/components/admin/MissionControl";
import { engineVerdict, type EngineHealth } from "@/lib/ops/engine-health";

export const metadata = {
  title: "Mission control",
};

export default async function MissionControlPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?redirect=/admin/mission");
  if (!isAdmin(user.email)) redirect("/");

  const admin = createAdminClient();
  const [mission, health] = await Promise.all([
    admin.rpc("mission_control", { p_days: 7 }),
    admin.rpc("engine_health", { p_minutes: 60 }),
  ]);

  const data = mission.data as MissionData | null;
  const reading = health.data as EngineHealth | null;
  const updatedAt = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/admin" prefetch={false} className="text-sm font-medium text-slate-700 hover:text-slate-900">
            ← Admin
          </Link>
          <Link href="/admin/mission" prefetch={false} className="text-sm text-slate-500 hover:text-slate-900">
            Refresh
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {data && reading ? (
          <MissionControl data={data} health={reading} verdict={engineVerdict(reading)} updatedAt={updatedAt} />
        ) : (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            The numbers could not be read: {mission.error?.message ?? health.error?.message ?? "no data"}
          </p>
        )}
      </main>
    </div>
  );
}
