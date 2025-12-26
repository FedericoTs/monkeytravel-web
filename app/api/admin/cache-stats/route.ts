import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getCacheStats, CACHE_TTL, CACHE_TTL_DAYS } from "@/lib/cache";
import { getCacheStats as getAmadeusCacheStats } from "@/lib/amadeus/cache";
import { getDedupStats } from "@/lib/gemini-dedup";

/**
 * GET /api/admin/cache-stats - Get cache statistics for monitoring
 *
 * Returns statistics from:
 * - Unified cache manager (memory + database)
 * - Amadeus API cache
 * - Gemini request deduplication
 *
 * Use this to:
 * - Monitor cache hit rates
 * - Identify optimization opportunities
 * - Track deduplication effectiveness
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify admin access
    const { data: profile } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) {
      return errors.forbidden("Admin access required");
    }

    // Gather stats from all cache systems
    const unifiedCache = getCacheStats();
    const amadeusCache = getAmadeusCacheStats();
    const geminiDedup = getDedupStats();

    // Calculate overall effectiveness
    const totalHits = unifiedCache.hits + amadeusCache.hits;
    const totalMisses = unifiedCache.misses + amadeusCache.misses;
    const totalRequests = totalHits + totalMisses;
    const overallHitRate = totalRequests > 0
      ? ((totalHits / totalRequests) * 100).toFixed(1)
      : "0.0";

    // Format TTL configuration for display
    const ttlConfig = Object.entries(CACHE_TTL).map(([type, ms]) => ({
      type,
      memory_ttl: formatDuration(ms),
      database_ttl: CACHE_TTL_DAYS[type as keyof typeof CACHE_TTL_DAYS]
        ? `${CACHE_TTL_DAYS[type as keyof typeof CACHE_TTL_DAYS]} days`
        : "N/A",
    }));

    return apiSuccess({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        overall_hit_rate: `${overallHitRate}%`,
        total_requests: totalRequests,
        total_hits: totalHits,
        total_misses: totalMisses,
        gemini_coalesced: geminiDedup.coalescedRequests,
        gemini_coalesce_rate: geminiDedup.totalRequests > 0
          ? `${((geminiDedup.coalescedRequests / geminiDedup.totalRequests) * 100).toFixed(1)}%`
          : "0.0%",
      },
      unified_cache: {
        ...unifiedCache,
        description: "Memory cache with optional database backing",
      },
      amadeus_cache: {
        ...amadeusCache,
        description: "Amadeus API response cache",
      },
      gemini_dedup: {
        ...geminiDedup,
        description: "Concurrent request deduplication for Gemini AI",
      },
      ttl_configuration: ttlConfig,
      recommendations: generateRecommendations(unifiedCache, amadeusCache, geminiDedup),
    });
  } catch (error) {
    console.error("[Cache Stats] Error:", error);
    return errors.internal("Failed to fetch cache stats", "CacheStats");
  }
}

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  return `${Math.round(ms / (24 * 60 * 60 * 1000))}d`;
}

/**
 * Generate optimization recommendations based on stats
 */
function generateRecommendations(
  unified: ReturnType<typeof getCacheStats>,
  amadeus: ReturnType<typeof getAmadeusCacheStats>,
  dedup: ReturnType<typeof getDedupStats>
): string[] {
  const recommendations: string[] = [];

  // Check unified cache hit rate
  const unifiedTotal = unified.hits + unified.misses;
  if (unifiedTotal > 100) {
    const hitRate = (unified.hits / unifiedTotal) * 100;
    if (hitRate < 20) {
      recommendations.push("Low unified cache hit rate (<20%). Consider extending TTLs or pre-warming cache.");
    } else if (hitRate > 80) {
      recommendations.push("Excellent unified cache hit rate (>80%). Cache is working effectively.");
    }
  }

  // Check Amadeus cache hit rate
  const amadeusTotal = amadeus.hits + amadeus.misses;
  if (amadeusTotal > 50) {
    const hitRate = (amadeus.hits / amadeusTotal) * 100;
    if (hitRate < 30) {
      recommendations.push("Low Amadeus cache hit rate. Users may be searching unique routes frequently.");
    }
  }

  // Check memory usage
  if (unified.memorySize > 800) {
    recommendations.push("Memory cache near limit (>800 entries). Consider LRU eviction tuning.");
  }

  // Check deduplication effectiveness
  if (dedup.totalRequests > 20 && dedup.coalescedRequests === 0) {
    recommendations.push("No Gemini requests coalesced. Deduplication working but no concurrent duplicates detected.");
  } else if (dedup.coalescedRequests > 0) {
    const rate = (dedup.coalescedRequests / dedup.totalRequests) * 100;
    if (rate > 10) {
      recommendations.push(`Good deduplication: ${rate.toFixed(1)}% of Gemini requests coalesced, saving API costs.`);
    }
  }

  // Check evictions
  if (unified.evictions > unified.hits) {
    recommendations.push("High eviction rate. Cache may be undersized or TTLs too long for available memory.");
  }

  if (recommendations.length === 0) {
    recommendations.push("Cache systems operating normally. No immediate optimizations needed.");
  }

  return recommendations;
}
