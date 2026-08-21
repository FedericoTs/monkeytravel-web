import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCacheStats } from "@/lib/cache";
import { getCacheStats as getAmadeusCacheStats } from "@/lib/amadeus/cache";
import { circuitBreakerManager } from "@/lib/api-gateway/interceptors/circuit-breaker";

const startedAt = Date.now();

interface HealthCheck {
  name: string;
  status: "ok" | "degraded" | "down";
  latency_ms?: number;
  message?: string;
}

/**
 * GET /api/health - Public health check endpoint
 *
 * Returns system health status for uptime monitoring.
 * No authentication required — designed for external monitors
 * (UptimeRobot, Datadog, Vercel, etc.)
 */
export async function GET() {
  const checks: HealthCheck[] = [];
  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

  // 1. Database connectivity check
  const dbStart = Date.now();
  try {
    // Probes public_profiles, not users: this endpoint is unauthenticated, and
    // public.users is restricted to the row owner. As anon that query returns
    // zero rows WITHOUT an error, so it would report "ok" while reading
    // nothing — a connectivity probe that cannot fail is worthless.
    const { data: probe, error } = await supabase
      .from("public_profiles")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (!error && !probe) {
      // Reachable but returning nothing: a grant or policy regression looks
      // exactly like this. Degraded, not down — the database is up.
      checks.push({
        name: "database",
        status: "degraded",
        latency_ms: Date.now() - dbStart,
        message: "Reachable but returned no rows",
      });
      if (overallStatus === "healthy") overallStatus = "degraded";
    } else if (error) {
      checks.push({
        name: "database",
        status: "down",
        latency_ms: Date.now() - dbStart,
        message: "Query failed",
      });
      overallStatus = "unhealthy";
    } else {
      checks.push({
        name: "database",
        status: "ok",
        latency_ms: Date.now() - dbStart,
      });
    }
  } catch {
    checks.push({
      name: "database",
      status: "down",
      latency_ms: Date.now() - dbStart,
      message: "Connection failed",
    });
    overallStatus = "unhealthy";
  }

  // 2. Cache health
  const cacheStats = getCacheStats();
  const amadeusCacheStats = getAmadeusCacheStats();
  const totalCacheEntries = cacheStats.memorySize + amadeusCacheStats.size;
  const cacheStatus: "ok" | "degraded" =
    cacheStats.memorySize > 900 || amadeusCacheStats.size > 900
      ? "degraded"
      : "ok";

  if (cacheStatus === "degraded" && overallStatus === "healthy") {
    overallStatus = "degraded";
  }

  checks.push({
    name: "cache",
    status: cacheStatus,
    message: `${totalCacheEntries} entries (unified: ${cacheStats.memorySize}, amadeus: ${amadeusCacheStats.size})`,
  });

  // 3. Circuit breaker status
  const circuitStats = circuitBreakerManager.getAllStats();
  const openCircuits = Object.entries(circuitStats).filter(
    ([, s]) => s.state === "OPEN"
  );

  if (openCircuits.length > 0) {
    if (overallStatus === "healthy") overallStatus = "degraded";
    checks.push({
      name: "circuit_breakers",
      status: "degraded",
      message: `${openCircuits.length} open: ${openCircuits.map(([name]) => name).join(", ")}`,
    });
  } else {
    checks.push({
      name: "circuit_breakers",
      status: "ok",
      message: `${Object.keys(circuitStats).length} monitored, all closed`,
    });
  }

  // 4. Environment check
  const hasRequiredEnv = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  checks.push({
    name: "environment",
    status: hasRequiredEnv ? "ok" : "down",
    message: hasRequiredEnv ? undefined : "Missing required env vars",
  });

  if (!hasRequiredEnv && overallStatus !== "unhealthy") {
    overallStatus = "unhealthy";
  }

  const statusCode = overallStatus === "unhealthy" ? 503 : 200;

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime_ms: Date.now() - startedAt,
      checks,
    },
    { status: statusCode }
  );
}
