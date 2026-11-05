import type { AdminStats } from "./types";

// Daily user registration trend for the last 90 days
export function userTrend(users: { created_at: string }[]): AdminStats["userTrend"] {
  if (users.length === 0) {
    return {
      daily: [],
      summary: {
        totalGrowth: 0,
        avgDaily: 0,
        bestDay: null,
        currentStreak: 0,
      },
    };
  }

  // Generate date range for the last 90 days
  const now = new Date();
  const day90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Group users by date
  const countsByDate = new Map<string, number>();
  users.forEach((user) => {
    const date = new Date(user.created_at).toISOString().split("T")[0];
    countsByDate.set(date, (countsByDate.get(date) || 0) + 1);
  });

  // Build daily array with cumulative counts
  const daily: { date: string; count: number; cumulative: number }[] = [];
  let cumulative = 0;

  // Get all users before our 90-day window for cumulative base
  const usersBeforeWindow = users.filter(
    (u) => new Date(u.created_at) < day90Ago
  ).length;
  cumulative = usersBeforeWindow;

  // Iterate through each day in the 90-day window
  for (let d = day90Ago.getTime(); d <= now.getTime(); d += 86_400_000) {
    const dateStr = new Date(d).toISOString().split("T")[0];
    const count = countsByDate.get(dateStr) || 0;
    cumulative += count;
    daily.push({ date: dateStr, count, cumulative });
  }

  // Calculate summary stats
  const daysWithData = daily.filter((d) => d.count > 0);
  const totalRegistrations = daily.reduce((sum, d) => sum + d.count, 0);
  const avgDaily = daily.length > 0 ? Math.round((totalRegistrations / daily.length) * 10) / 10 : 0;

  // Find best day
  let bestDay: { date: string; count: number } | null = null;
  if (daysWithData.length > 0) {
    const best = daysWithData.reduce((max, d) => (d.count > max.count ? d : max), daysWithData[0]);
    bestDay = { date: best.date, count: best.count };
  }

  // Calculate growth percentage (compare first week to last week)
  const firstWeekTotal = daily.slice(0, 7).reduce((sum, d) => sum + d.count, 0);
  const lastWeekTotal = daily.slice(-7).reduce((sum, d) => sum + d.count, 0);
  const totalGrowth = firstWeekTotal > 0
    ? Math.round(((lastWeekTotal - firstWeekTotal) / firstWeekTotal) * 100)
    : lastWeekTotal > 0 ? 100 : 0;

  // Calculate current streak (consecutive days with signups ending today)
  let currentStreak = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].count > 0) {
      currentStreak++;
    } else {
      break;
    }
  }

  return {
    daily,
    summary: {
      totalGrowth,
      avgDaily,
      bestDay,
      currentStreak,
    },
  };
}
