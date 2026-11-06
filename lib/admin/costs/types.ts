import type { CreditEstimate } from "@/lib/ops/gemini-credit";

export interface EnhancedCostAnalytics {
  // Summary metrics
  summary: {
    totalCostUsd: number;
    todayCostUsd: number;
    last7DaysCostUsd: number;
    last30DaysCostUsd: number;
    totalRequests: number;
    todayRequests: number;
    avgCostPerRequest: number;
    projectedMonthlyCost: number;
  };

  // Performance metrics
  performance: {
    avgResponseTimeMs: number;
    p50ResponseTimeMs: number;
    p95ResponseTimeMs: number;
    p99ResponseTimeMs: number;
    errorRate: number;
    totalErrors: number;
    successRate: number;
  };

  // Cache performance
  cache: {
    hitRate: number;
    totalHits: number;
    totalMisses: number;
    estimatedSavingsUsd: number;
    byType: {
      geocode: { entries: number; hits: number };
      distance: { entries: number; hits: number };
      places: { entries: number; hits: number };
      activities: { entries: number; hits: number };
    };
  };

  // Circuit breaker status for each API
  circuitBreakers: {
    apiName: string;
    state: "CLOSED" | "OPEN" | "HALF_OPEN";
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  }[];

  // Cost breakdown by API
  byApi: {
    apiName: string;
    displayName: string;
    totalCost: number;
    requestCount: number;
    cacheHits: number;
    cacheMisses: number;
    errorCount: number;
    errorRate: number;
    avgResponseTimeMs: number;
    color: string;
  }[];

  // Per-user cost breakdown (top 10)
  byUser: {
    userId: string;
    email?: string;
    totalCost: number;
    requestCount: number;
  }[];

  // Daily trend (last 30 days)
  dailyTrend: {
    date: string;
    cost: number;
    requests: number;
    cacheHits: number;
    errors: number;
  }[];

  // Hourly trend (last 24 hours)
  hourlyTrend: {
    hour: string;
    cost: number;
    requests: number;
    avgLatency: number;
  }[];

  // Top expensive endpoints
  topEndpoints: {
    endpoint: string;
    apiName: string;
    cost: number;
    count: number;
    avgLatency: number;
  }[];

  // Recent activity (last 50 requests)
  recentActivity: {
    id: string;
    timestamp: string;
    apiName: string;
    endpoint: string;
    status: number;
    responseTimeMs: number;
    costUsd: number;
    cacheHit: boolean;
    error?: string;
  }[];

  // What's left of the prepaid Gemini credit, once a balance has been typed
  credit: CreditEstimate | null;

  // Timestamp
  generatedAt: string;
}
