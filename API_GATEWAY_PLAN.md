# API Gateway Implementation Plan

## Executive Summary

Implement a centralized API Gateway that all external API requests pass through for:
- **Unified tracking** of all API costs and usage
- **Resilience** via retry, circuit breaker, and deduplication
- **Cost visibility** with real-time monitoring
- **Performance** via batched logging (reduces DB writes by 90%)

## Current State Analysis

### Tracking Gaps Identified

| API | Current Status | Cost/Request | Action |
|-----|---------------|--------------|--------|
| Google Places | ✅ Logged | $0.017 | Migrate to gateway |
| Google Geocoding | ✅ Logged | $0.005 | Migrate to gateway |
| Google Distance | ✅ Logged | $0.005/element | Migrate to gateway |
| Gemini AI | ✅ Logged | $0.003 | Migrate to gateway |
| Open-Meteo Weather | ❌ Not logged | FREE | Add tracking |
| Pexels Images | ❌ Not logged | FREE | Add tracking |
| Amadeus Flights | ✅ Partially | ~$0.01 | Improve tracking |
| Amadeus Hotels | ❌ Skipped | ~$0.01 | Add async logging |
| Amadeus Locations | ❌ Not logged | FREE | Add tracking |

### Missing Metrics
- Real `response_time_ms` (currently hardcoded to 0)
- Per-user cost attribution
- Error response logging
- Token usage for AI APIs

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js API Routes                          │
│  /api/places  /api/ai/generate  /api/amadeus  /api/weather     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Gateway Client                         │
│                     lib/api-gateway/client.ts                   │
├─────────────────────────────────────────────────────────────────┤
│  Interceptors (executed in order):                              │
│  1. [dedup]    - Coalesce concurrent identical requests         │
│  2. [retry]    - Exponential backoff with jitter               │
│  3. [circuit]  - Circuit breaker for failing APIs              │
│  4. [cost]     - Track estimated costs per API                 │
│  5. [logging]  - Batch log to database (last)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Google APIs    │  │  Amadeus APIs   │  │  Other APIs     │
│  - Places       │  │  - Flights      │  │  - Gemini       │
│  - Geocoding    │  │  - Hotels       │  │  - Open-Meteo   │
│  - Distance     │  │  - Locations    │  │  - Pexels       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase (Batched Insert)                    │
│                      api_request_logs                           │
│  - Batch size: 50 requests                                      │
│  - Flush interval: 5 seconds                                    │
│  - ~90% reduction in DB writes                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
lib/
├── api-gateway/
│   ├── index.ts              # Main exports
│   ├── client.ts             # Core gateway client
│   ├── types.ts              # TypeScript interfaces
│   ├── config.ts             # API costs and limits
│   ├── interceptors/
│   │   ├── index.ts          # Interceptor exports
│   │   ├── logging.ts        # Batch logging
│   │   ├── retry.ts          # Exponential backoff
│   │   ├── circuit-breaker.ts
│   │   └── cost-tracker.ts   # Per-API cost calculation
│   └── clients/
│       ├── google.ts         # Google APIs client
│       ├── amadeus.ts        # Amadeus APIs client
│       └── external.ts       # Generic external APIs
```

## Implementation Details

### Phase 1: Core Gateway Client

```typescript
// lib/api-gateway/types.ts
export interface ApiConfig {
  apiName: string;
  endpoint: string;
  costPerRequest: number;
  maxRetries?: number;
  timeout?: number;
  skipLogging?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  meta: {
    cached: boolean;
    responseTimeMs: number;
    cost: number;
    retries: number;
  };
}

export interface LogEntry {
  api_name: string;
  endpoint: string;
  request_params: Record<string, unknown>;
  response_status: number;
  response_time_ms: number;
  cache_hit: boolean;
  cost_usd: number;
  user_id?: string;
  error_message?: string;
  timestamp: Date;
}
```

### Phase 2: API Cost Configuration

```typescript
// lib/api-gateway/config.ts
export const API_COSTS = {
  // Google APIs
  'google_places_search': 0.017,
  'google_places_autocomplete': 0.00283,
  'google_places_details': 0.017,
  'google_places_nearby': 0.032,
  'google_geocoding': 0.005,
  'google_distance_matrix': 0.005, // per element

  // AI APIs
  'gemini_generate': 0.003,
  'gemini_regenerate': 0.002,

  // Amadeus APIs (estimates)
  'amadeus_flights': 0.01,
  'amadeus_hotels': 0.01,
  'amadeus_locations': 0, // Free tier

  // Free APIs (track for analytics)
  'open_meteo': 0,
  'pexels': 0,
} as const;

export const RATE_LIMITS = {
  'google_places': { perMinute: 100, perDay: 5000 },
  'amadeus': { perMinute: 10, perDay: 2000 },
  'gemini': { perMinute: 15, perDay: 1500 },
} as const;
```

### Phase 3: Batch Logger

```typescript
// lib/api-gateway/interceptors/logging.ts
class BatchLogger {
  private batch: LogEntry[] = [];
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startAutoFlush();
  }

  async log(entry: LogEntry): Promise<void> {
    this.batch.push(entry);

    if (this.batch.length >= this.BATCH_SIZE) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const entries = [...this.batch];
    this.batch = [];

    try {
      const supabase = await createClient();
      await supabase.from('api_request_logs').insert(entries);
      console.log(`[ApiGateway] Flushed ${entries.length} log entries`);
    } catch (error) {
      console.error('[ApiGateway] Failed to flush logs:', error);
      // Re-add failed entries (with limit to prevent memory issues)
      if (this.batch.length < 500) {
        this.batch.unshift(...entries);
      }
    }
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
  }
}

export const batchLogger = new BatchLogger();
```

### Phase 4: Circuit Breaker

```typescript
// lib/api-gateway/interceptors/circuit-breaker.ts
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIMEOUT = 60000; // 60 seconds

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.RECOVERY_TIMEOUT) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.apiName}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      console.warn(`[CircuitBreaker] Opened for ${this.apiName}`);
    }
  }
}
```

## Migration Strategy

### Step 1: Create Gateway (Non-Breaking)
- Add new `lib/api-gateway/` structure
- Don't modify existing routes yet

### Step 2: Add to New Routes First
- Test with a single route (e.g., `/api/weather`)
- Verify logging works correctly

### Step 3: Migrate Existing Routes
Priority order:
1. Weather API (not logged, simple)
2. Pexels API (not logged, simple)
3. Amadeus locations (not logged)
4. Amadeus hotels (logging skipped)
5. Google APIs (already logged, just migrate)

### Step 4: Remove Old Logging Code
- After gateway is proven, remove inline logging
- Keep gateway as single source of truth

## Database Updates

### Add User ID Tracking
```sql
-- Add user_id column for per-user cost attribution
ALTER TABLE api_request_logs
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Index for per-user queries
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id
ON api_request_logs(user_id, timestamp DESC);
```

### Materialized View for Daily Costs
```sql
-- Create materialized view for fast cost queries
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_api_costs AS
SELECT
  DATE(timestamp) as date,
  api_name,
  COUNT(*) as request_count,
  SUM(cost_usd) as total_cost,
  AVG(response_time_ms) as avg_latency,
  SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) as cache_hits,
  COUNT(DISTINCT user_id) as unique_users
FROM api_request_logs
WHERE timestamp > NOW() - INTERVAL '90 days'
GROUP BY DATE(timestamp), api_name
ORDER BY date DESC, total_cost DESC;

-- Refresh via Supabase cron or edge function
-- REFRESH MATERIALIZED VIEW CONCURRENTLY daily_api_costs;
```

## Expected Benefits

### Cost Visibility
- **Before**: Incomplete tracking, ~60% of APIs logged
- **After**: 100% tracking with per-user attribution

### Performance
- **Before**: 1 DB write per API call
- **After**: 1 DB write per 50 API calls (98% reduction)

### Resilience
- **Before**: No retry, no circuit breaker
- **After**: Automatic retry with backoff, circuit breaker protection

### Deduplication
- **Before**: Some APIs use request-dedup.ts
- **After**: All APIs through gateway with built-in dedup

## Timeline

- **Phase 1** (Core Gateway): 2-3 hours
- **Phase 2** (Interceptors): 3-4 hours
- **Phase 3** (API Clients): 2-3 hours
- **Phase 4** (Migration): 4-6 hours
- **Phase 5** (Testing): 2-3 hours

**Total: ~15-20 hours**

## Success Metrics

1. **100% API tracking** - All external API calls logged
2. **Real response times** - Actual latency captured
3. **Per-user costs** - Track spending by user
4. **90% fewer DB writes** - Batch logging efficiency
5. **Circuit breaker activations** - Track API reliability
6. **Deduplication rate** - Measure savings from dedup
