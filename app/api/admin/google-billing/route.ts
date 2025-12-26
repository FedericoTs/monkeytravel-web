import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

export interface GoogleBillingData {
  configured: boolean;
  error?: string;

  // Summary
  summary: {
    totalCostUsd: number;
    todayCostUsd: number;
    last7DaysCostUsd: number;
    last30DaysCostUsd: number;
    currentMonthCostUsd: number;
    previousMonthCostUsd: number;
  };

  // Cost by service
  byService: {
    service: string;
    description: string;
    totalCost: number;
    last7DaysCost: number;
  }[];

  // Daily costs for trend
  dailyCosts: {
    date: string;
    totalCost: number;
    byService: Record<string, number>;
  }[];

  // Cumulative trend
  cumulativeCosts: {
    date: string;
    cumulativeTotal: number;
    dailyCost: number;
  }[];

  // SKU breakdown (detailed)
  bySkU: {
    service: string;
    sku: string;
    description: string;
    cost: number;
    usage: number;
    unit: string;
  }[];
}

interface BigQueryRow {
  f: Array<{ v: string | null }>;
}

interface BigQueryResponse {
  kind: string;
  schema: {
    fields: Array<{ name: string; type: string }>;
  };
  rows?: BigQueryRow[];
  totalRows?: string;
  jobComplete: boolean;
  errors?: Array<{ message: string }>;
}

/**
 * Get BigQuery access token using service account credentials
 */
async function getAccessToken(): Promise<string | null> {
  const serviceAccountKey = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKey) {
    return null;
  }

  try {
    const credentials = JSON.parse(
      Buffer.from(serviceAccountKey, "base64").toString("utf-8")
    );

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/bigquery.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

    const crypto = await import("crypto");
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(`${header}.${body}`);
    const signature = sign.sign(credentials.private_key, "base64url");

    const jwt = `${header}.${body}.${signature}`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenResponse.ok) {
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error("[Google Billing] Error getting BigQuery access token:", error);
    return null;
  }
}

/**
 * Execute BigQuery SQL query
 */
async function queryBigQuery(
  accessToken: string,
  projectId: string,
  query: string
): Promise<BigQueryResponse | null> {
  try {
    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          useLegacySql: false,
          maxResults: 1000,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Google Billing] BigQuery error:", errorText);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("[Google Billing] BigQuery query error:", error);
    return null;
  }
}

/**
 * GET /api/admin/google-billing - Get actual Google Cloud billing data from BigQuery
 */
export async function GET() {
  try {
    const { errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    // Check if BigQuery is configured
    const serviceAccountKey = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const billingDataset = process.env.GOOGLE_CLOUD_BILLING_DATASET;
    const billingTable = process.env.GOOGLE_CLOUD_BILLING_TABLE;

    if (!serviceAccountKey || !projectId || !billingDataset || !billingTable) {
      return apiSuccess<GoogleBillingData>({
        configured: false,
        error: "BigQuery billing export not configured. Required: GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_BILLING_DATASET, GOOGLE_CLOUD_BILLING_TABLE",
        summary: {
          totalCostUsd: 0,
          todayCostUsd: 0,
          last7DaysCostUsd: 0,
          last30DaysCostUsd: 0,
          currentMonthCostUsd: 0,
          previousMonthCostUsd: 0,
        },
        byService: [],
        dailyCosts: [],
        cumulativeCosts: [],
        bySkU: [],
      });
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      return apiSuccess<GoogleBillingData>({
        configured: false,
        error: "Failed to authenticate with Google Cloud",
        summary: {
          totalCostUsd: 0,
          todayCostUsd: 0,
          last7DaysCostUsd: 0,
          last30DaysCostUsd: 0,
          currentMonthCostUsd: 0,
          previousMonthCostUsd: 0,
        },
        byService: [],
        dailyCosts: [],
        cumulativeCosts: [],
        bySkU: [],
      });
    }

    const fullTableName = `${projectId}.${billingDataset}.${billingTable}`;

    // Query 1: Summary metrics
    const summaryQuery = `
      SELECT
        SUM(cost) as total_cost,
        SUM(CASE WHEN DATE(usage_start_time) = CURRENT_DATE() THEN cost ELSE 0 END) as today_cost,
        SUM(CASE WHEN DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) THEN cost ELSE 0 END) as last_7_days,
        SUM(CASE WHEN DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) THEN cost ELSE 0 END) as last_30_days,
        SUM(CASE WHEN EXTRACT(MONTH FROM usage_start_time) = EXTRACT(MONTH FROM CURRENT_DATE())
                  AND EXTRACT(YEAR FROM usage_start_time) = EXTRACT(YEAR FROM CURRENT_DATE()) THEN cost ELSE 0 END) as current_month,
        SUM(CASE WHEN EXTRACT(MONTH FROM usage_start_time) = EXTRACT(MONTH FROM DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))
                  AND EXTRACT(YEAR FROM usage_start_time) = EXTRACT(YEAR FROM DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) THEN cost ELSE 0 END) as previous_month
      FROM \`${fullTableName}\`
      WHERE service.description LIKE '%Maps%' OR service.description LIKE '%Geocoding%' OR service.description LIKE '%Places%' OR service.description LIKE '%Routes%'
    `;

    // Query 2: Cost by service
    const byServiceQuery = `
      SELECT
        service.description as service,
        SUM(cost) as total_cost,
        SUM(CASE WHEN DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) THEN cost ELSE 0 END) as last_7_days_cost
      FROM \`${fullTableName}\`
      WHERE (service.description LIKE '%Maps%' OR service.description LIKE '%Geocoding%' OR service.description LIKE '%Places%' OR service.description LIKE '%Routes%')
        AND DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      GROUP BY service.description
      ORDER BY total_cost DESC
    `;

    // Query 3: Daily costs
    const dailyQuery = `
      SELECT
        DATE(usage_start_time) as date,
        service.description as service,
        SUM(cost) as daily_cost
      FROM \`${fullTableName}\`
      WHERE (service.description LIKE '%Maps%' OR service.description LIKE '%Geocoding%' OR service.description LIKE '%Places%' OR service.description LIKE '%Routes%')
        AND DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      GROUP BY DATE(usage_start_time), service.description
      ORDER BY date
    `;

    // Query 4: SKU breakdown
    const skuQuery = `
      SELECT
        service.description as service,
        sku.id as sku_id,
        sku.description as sku_description,
        SUM(cost) as cost,
        SUM(usage.amount) as usage_amount,
        usage.unit as usage_unit
      FROM \`${fullTableName}\`
      WHERE (service.description LIKE '%Maps%' OR service.description LIKE '%Geocoding%' OR service.description LIKE '%Places%' OR service.description LIKE '%Routes%')
        AND DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      GROUP BY service.description, sku.id, sku.description, usage.unit
      ORDER BY cost DESC
      LIMIT 20
    `;

    // Execute all queries
    const [summaryResult, byServiceResult, dailyResult, skuResult] = await Promise.all([
      queryBigQuery(accessToken, projectId, summaryQuery),
      queryBigQuery(accessToken, projectId, byServiceQuery),
      queryBigQuery(accessToken, projectId, dailyQuery),
      queryBigQuery(accessToken, projectId, skuQuery),
    ]);

    // Parse results
    const summary = {
      totalCostUsd: 0,
      todayCostUsd: 0,
      last7DaysCostUsd: 0,
      last30DaysCostUsd: 0,
      currentMonthCostUsd: 0,
      previousMonthCostUsd: 0,
    };

    if (summaryResult?.rows?.[0]) {
      const row = summaryResult.rows[0].f;
      summary.totalCostUsd = parseFloat(row[0]?.v || "0");
      summary.todayCostUsd = parseFloat(row[1]?.v || "0");
      summary.last7DaysCostUsd = parseFloat(row[2]?.v || "0");
      summary.last30DaysCostUsd = parseFloat(row[3]?.v || "0");
      summary.currentMonthCostUsd = parseFloat(row[4]?.v || "0");
      summary.previousMonthCostUsd = parseFloat(row[5]?.v || "0");
    }

    const byService = (byServiceResult?.rows || []).map((row) => ({
      service: row.f[0]?.v || "Unknown",
      description: row.f[0]?.v || "Unknown",
      totalCost: parseFloat(row.f[1]?.v || "0"),
      last7DaysCost: parseFloat(row.f[2]?.v || "0"),
    }));

    // Parse daily costs and build cumulative
    const dailyMap = new Map<string, { total: number; byService: Record<string, number> }>();

    (dailyResult?.rows || []).forEach((row) => {
      const date = row.f[0]?.v || "";
      const service = row.f[1]?.v || "Other";
      const cost = parseFloat(row.f[2]?.v || "0");

      if (!dailyMap.has(date)) {
        dailyMap.set(date, { total: 0, byService: {} });
      }
      const day = dailyMap.get(date)!;
      day.total += cost;
      day.byService[service] = (day.byService[service] || 0) + cost;
    });

    const dailyCosts = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        totalCost: Math.round(data.total * 1000) / 1000,
        byService: data.byService,
      }));

    // Build cumulative trend
    let cumulative = 0;
    const cumulativeCosts = dailyCosts.map((day) => {
      cumulative += day.totalCost;
      return {
        date: day.date,
        dailyCost: day.totalCost,
        cumulativeTotal: Math.round(cumulative * 1000) / 1000,
      };
    });

    const bySkU = (skuResult?.rows || []).map((row) => ({
      service: row.f[0]?.v || "Unknown",
      sku: row.f[1]?.v || "",
      description: row.f[2]?.v || "",
      cost: parseFloat(row.f[3]?.v || "0"),
      usage: parseFloat(row.f[4]?.v || "0"),
      unit: row.f[5]?.v || "",
    }));

    return apiSuccess<GoogleBillingData>({
      configured: true,
      summary,
      byService,
      dailyCosts,
      cumulativeCosts,
      bySkU,
    });
  } catch (error) {
    console.error("[Google Billing] Error:", error);
    return errors.internal("Failed to fetch billing data", "Google Billing");
  }
}
