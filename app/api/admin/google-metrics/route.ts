import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

// Google Cloud Monitoring API types
interface TimeSeriesPoint {
  interval: {
    startTime: string;
    endTime: string;
  };
  value: {
    int64Value?: string;
    doubleValue?: number;
  };
}

interface TimeSeries {
  metric: {
    type: string;
    labels?: Record<string, string>;
  };
  resource: {
    type: string;
    labels?: Record<string, string>;
  };
  points: TimeSeriesPoint[];
}

interface TimeSeriesResponse {
  timeSeries?: TimeSeries[];
  nextPageToken?: string;
}

// API cost estimates per request (USD) - Google Maps pricing
// Note: These are BEFORE the $200/month free credit
// Actual costs will be lower due to free tier
const API_COSTS: Record<string, number> = {
  "geocoding-backend.googleapis.com": 0.005,    // Geocoding API ~$5/1000
  "places-backend.googleapis.com": 0.017,       // Places API ~$17/1000 (Text Search)
  "routes.googleapis.com": 0.005,               // Distance Matrix ~$5/1000
  "maps-backend.googleapis.com": 0.007,         // Static Maps ~$7/1000
};

// Google provides $200/month free credit for Maps APIs
const MONTHLY_FREE_CREDIT = 200;

// Google Maps service identifiers
const MAPS_SERVICES = [
  "geocoding-backend.googleapis.com",
  "places-backend.googleapis.com",
  "routes.googleapis.com",
  "maps-backend.googleapis.com",
  "distancematrix-backend.googleapis.com",
];

export interface GoogleMetrics {
  configured: boolean;
  error?: string;
  projectId?: string;

  // Cost summary
  costSummary?: {
    grossCost: number;        // Total before free tier
    freeCredit: number;       // $200 monthly free credit
    netCost: number;          // Actual estimated charge
    note: string;             // Explanation
  };

  // Real request counts from Google
  requestCounts: {
    service: string;
    displayName: string;
    total: number;
    today: number;
    last7Days: number;
    last30Days: number;
    estimatedCost: number;
  }[];

  // Daily breakdown for trends
  dailyUsage: {
    date: string;
    byService: Record<string, number>;
    totalRequests: number;
    estimatedCost: number;
  }[];

  // Comparison with our logged data
  comparison?: {
    googleTotal: number;
    loggedTotal: number;
    discrepancy: number;
    discrepancyPercent: number;
    alert: boolean;
  };
}

/**
 * Get Google Cloud access token using service account credentials
 */
async function getAccessToken(): Promise<string | null> {
  const serviceAccountKey = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKey) {
    return null;
  }

  try {
    // Decode base64 service account key
    const credentials = JSON.parse(
      Buffer.from(serviceAccountKey, "base64").toString("utf-8")
    );

    // Create JWT for Google OAuth
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/monitoring.read",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    // Sign JWT (simplified - in production use jose or similar library)
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

    // For Node.js crypto signing
    const crypto = await import("crypto");
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(`${header}.${body}`);
    const signature = sign.sign(credentials.private_key, "base64url");

    const jwt = `${header}.${body}.${signature}`;

    // Exchange JWT for access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Failed to get access token:", await tokenResponse.text());
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error("Error getting access token:", error);
    return null;
  }
}

/**
 * Query Cloud Monitoring API for request counts
 */
async function queryMetrics(
  accessToken: string,
  projectId: string,
  service: string,
  startTime: Date,
  endTime: Date
): Promise<number> {
  const filter = encodeURIComponent(
    `metric.type = "serviceruntime.googleapis.com/api/request_count" AND resource.labels.service = "${service}"`
  );

  const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?` +
    `filter=${filter}&` +
    `interval.startTime=${startTime.toISOString()}&` +
    `interval.endTime=${endTime.toISOString()}&` +
    `aggregation.alignmentPeriod=86400s&` +
    `aggregation.perSeriesAligner=ALIGN_SUM`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Monitoring API error for ${service}:`, errorText);
      return 0;
    }

    const data: TimeSeriesResponse = await response.json();

    if (!data.timeSeries || data.timeSeries.length === 0) {
      return 0;
    }

    // Sum all points across all time series
    let total = 0;
    for (const series of data.timeSeries) {
      for (const point of series.points) {
        total += parseInt(point.value.int64Value || "0", 10);
      }
    }

    return total;
  } catch (error) {
    console.error(`Error querying metrics for ${service}:`, error);
    return 0;
  }
}

/**
 * Query daily breakdown for a service
 */
async function queryDailyMetrics(
  accessToken: string,
  projectId: string,
  service: string,
  days: number
): Promise<Record<string, number>> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

  const filter = encodeURIComponent(
    `metric.type = "serviceruntime.googleapis.com/api/request_count" AND resource.labels.service = "${service}"`
  );

  const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?` +
    `filter=${filter}&` +
    `interval.startTime=${startTime.toISOString()}&` +
    `interval.endTime=${endTime.toISOString()}&` +
    `aggregation.alignmentPeriod=86400s&` +
    `aggregation.perSeriesAligner=ALIGN_SUM`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return {};
    }

    const data: TimeSeriesResponse = await response.json();
    const dailyCounts: Record<string, number> = {};

    if (data.timeSeries) {
      for (const series of data.timeSeries) {
        for (const point of series.points) {
          const date = point.interval.endTime.split("T")[0];
          const count = parseInt(point.value.int64Value || "0", 10);
          dailyCounts[date] = (dailyCounts[date] || 0) + count;
        }
      }
    }

    return dailyCounts;
  } catch (error) {
    console.error(`Error querying daily metrics for ${service}:`, error);
    return {};
  }
}

/**
 * GET /api/admin/google-metrics - Get real Google Cloud metrics
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if Google Cloud credentials are configured
    const serviceAccountKey = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

    if (!serviceAccountKey || !projectId) {
      return NextResponse.json<GoogleMetrics>({
        configured: false,
        error: "Google Cloud credentials not configured. Add GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY and GOOGLE_CLOUD_PROJECT_ID to enable real metrics.",
        requestCounts: [],
        dailyUsage: [],
      });
    }

    // Get access token
    const accessToken = await getAccessToken();

    if (!accessToken) {
      return NextResponse.json<GoogleMetrics>({
        configured: false,
        error: "Failed to authenticate with Google Cloud. Check your service account credentials.",
        requestCounts: [],
        dailyUsage: [],
      });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Query metrics for each service
    const requestCounts = await Promise.all(
      MAPS_SERVICES.map(async (service) => {
        const [total, today, last7Days, last30Days] = await Promise.all([
          queryMetrics(accessToken, projectId, service, day30Ago, now),
          queryMetrics(accessToken, projectId, service, todayStart, now),
          queryMetrics(accessToken, projectId, service, day7Ago, now),
          queryMetrics(accessToken, projectId, service, day30Ago, now),
        ]);

        const costPerRequest = API_COSTS[service] || 0.01;

        return {
          service,
          displayName: formatServiceName(service),
          total: last30Days, // Use 30-day as "total" for this view
          today,
          last7Days,
          last30Days,
          estimatedCost: Math.round(last30Days * costPerRequest * 1000) / 1000,
        };
      })
    );

    // Get daily breakdown for the last 30 days
    const dailyByService: Record<string, Record<string, number>> = {};

    for (const service of MAPS_SERVICES) {
      const daily = await queryDailyMetrics(accessToken, projectId, service, 30);
      dailyByService[service] = daily;
    }

    // Combine into daily usage array
    const allDates = new Set<string>();
    Object.values(dailyByService).forEach(daily => {
      Object.keys(daily).forEach(date => allDates.add(date));
    });

    const dailyUsage = Array.from(allDates)
      .sort()
      .map(date => {
        const byService: Record<string, number> = {};
        let totalRequests = 0;
        let estimatedCost = 0;

        for (const service of MAPS_SERVICES) {
          const count = dailyByService[service]?.[date] || 0;
          if (count > 0) {
            byService[formatServiceName(service)] = count;
            totalRequests += count;
            estimatedCost += count * (API_COSTS[service] || 0.01);
          }
        }

        return {
          date,
          byService,
          totalRequests,
          estimatedCost: Math.round(estimatedCost * 1000) / 1000,
        };
      });

    // Get our logged data for comparison
    const { data: loggedData } = await supabase
      .from("api_request_logs")
      .select("cost_usd")
      .gte("timestamp", day30Ago.toISOString());

    const loggedTotal = loggedData?.length || 0;
    const googleTotal = requestCounts.reduce((sum, r) => sum + r.last30Days, 0);
    const discrepancy = googleTotal - loggedTotal;
    const discrepancyPercent = loggedTotal > 0
      ? Math.round((discrepancy / loggedTotal) * 100)
      : (googleTotal > 0 ? 100 : 0);

    // Calculate cost summary with free tier
    const grossCost = requestCounts.reduce((sum, r) => sum + r.estimatedCost, 0);
    const netCost = Math.max(0, grossCost - MONTHLY_FREE_CREDIT);

    return NextResponse.json<GoogleMetrics>({
      configured: true,
      projectId,
      costSummary: {
        grossCost: Math.round(grossCost * 100) / 100,
        freeCredit: MONTHLY_FREE_CREDIT,
        netCost: Math.round(netCost * 100) / 100,
        note: grossCost <= MONTHLY_FREE_CREDIT
          ? "All usage covered by Google's $200/month free credit"
          : `Estimated charge after $${MONTHLY_FREE_CREDIT} free credit`,
      },
      requestCounts: requestCounts.filter(r => r.total > 0),
      dailyUsage,
      comparison: {
        googleTotal,
        loggedTotal,
        discrepancy,
        discrepancyPercent,
        alert: discrepancyPercent > 10, // Alert if >10% discrepancy
      },
    });
  } catch (error) {
    console.error("Google metrics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Google metrics" },
      { status: 500 }
    );
  }
}

function formatServiceName(service: string): string {
  const names: Record<string, string> = {
    "geocoding-backend.googleapis.com": "Geocoding",
    "places-backend.googleapis.com": "Places",
    "routes.googleapis.com": "Routes/Distance",
    "maps-backend.googleapis.com": "Static Maps",
    "distancematrix-backend.googleapis.com": "Distance Matrix",
  };
  return names[service] || service.split(".")[0];
}
