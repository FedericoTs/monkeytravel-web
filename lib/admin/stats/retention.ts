import type { CohortData } from "./types";

// Activity-proxy: per-user activity timestamps from signals we actually record
// (trips, AI conversations, banana transactions). Replaces the never-synced
// users.last_sign_in_at for every "active" computation in this route.
export type ActivityRow = { id: string; user_id: string | null; created_at: string };

export function activityByUser(...tables: ActivityRow[][]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  tables.flat().forEach(({ user_id: uid, created_at: iso }) => {
    if (!uid || !iso) return;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return;
    const arr = m.get(uid);
    if (arr) arr.push(t);
    else m.set(uid, [t]);
  });
  return m;
}

// Cohort retention matrix - tracks weekly user retention (activity-based)
export function cohortRetention(
  users: { id: string; created_at: string }[],
  activity: Map<string, number[]>,
): CohortData[] {
  if (users.length === 0) return [];

  // Group users by signup week
  const cohorts = new Map<string, { users: typeof users; weekStart: Date }>();
  const now = new Date();

  users.forEach((user) => {
    const signupDate = new Date(user.created_at);
    // Get the Monday of the signup week
    const weekStart = getWeekStart(signupDate);
    const weekKey = weekStart.toISOString().split("T")[0];

    if (!cohorts.has(weekKey)) {
      cohorts.set(weekKey, { users: [], weekStart });
    }
    cohorts.get(weekKey)!.users.push(user);
  });

  // Calculate retention for each cohort
  const cohortData: CohortData[] = [];
  const sortedCohorts = Array.from(cohorts.entries()).sort(
    ([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
  );

  // Only show last 8 cohorts for readability
  const recentCohorts = sortedCohorts.slice(-8);

  recentCohorts.forEach(([_weekKey, { users: cohortUsers, weekStart }]) => {
    const cohortSize = cohortUsers.length;
    const retention: number[] = [];

    // Calculate weeks since cohort started
    const weeksSinceCohort = Math.floor(
      (now.getTime() - weekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    // Calculate retention for each week (Week 0 to current week)
    for (let week = 0; week <= Math.min(weeksSinceCohort, 7); week++) {
      // FIX: Count users who were active DURING this specific week (non-cumulative)
      // Previously this was cumulative (>= week start), now checks if active within week boundaries
      const weekNStart = new Date(weekStart.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      const weekNEnd = new Date(weekNStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const activeUsers = cohortUsers.filter((user) => {
        // Activity-proxy: active in week N = any tracked activity in the window.
        // Week 0 is 100% by definition (the cohort signed up that week).
        if (week === 0) return true;
        const times = activity.get(user.id) || [];
        return times.some((t) => t >= weekNStart.getTime() && t < weekNEnd.getTime());
      }).length;

      const retentionPct = cohortSize > 0 ? Math.round((activeUsers / cohortSize) * 100) : 0;
      retention.push(retentionPct);
    }

    // Format cohort label (e.g., "Nov 25")
    const cohortLabel = weekStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    cohortData.push({
      cohort: cohortLabel,
      cohortSize,
      retention,
    });
  });

  return cohortData;
}

// Helper: Get Monday of the week for a given date
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
