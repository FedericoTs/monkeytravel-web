import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * DEBUG ENDPOINT: Discover what Google Cloud services are actually being tracked
 * This will help us understand why our request counts don't match Google Console
 */

interface MetricDescriptor {
  type: string;
  labels?: Array<{ key: string }>;
  description?: string;
}

interface TimeSeriesData {
  metric: {
    type: string;
    labels?: Record<string, string>;
  };
  resource: {
    type: string;
    labels?: Record<string, string>;
  };
  points: Array<{
    interval: { startTime: string; endTime: string };
    value: { int64Value?: string; doubleValue?: number };
  }>;
}

async function getAccessToken(): Promise<string | null> {
  const serviceAccountKey = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) return null;

  try {
    const credentials = JSON.parse(
      Buffer.from(serviceAccountKey, "base64").toString("utf-8")
    );

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/monitoring.read https://www.googleapis.com/auth/cloud-billing.readonly",
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
      console.error("[Google Debug] Token error:", await tokenResponse.text());
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error("[Google Debug] Error getting access token:", error);
    return null;
  }
}

export async function GET() {
  try {
    const { errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (!projectId) {
      return errors.internal("GOOGLE_CLOUD_PROJECT_ID not set", "Google Debug");
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return errors.internal("Failed to get access token", "Google Debug");
    }

    const results: Record<string, unknown> = {
      projectId,
      timestamp: new Date().toISOString(),
      diagnostics: {},
    };

    // 1. List ALL metric descriptors to see what's available
    const metricsUrl = `https://monitoring.googleapis.com/v3/projects/${projectId}/metricDescriptors?filter=metric.type%3Dstarts_with(%22serviceruntime.googleapis.com%22)`;

    const metricsResponse = await fetch(metricsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (metricsResponse.ok) {
      const metricsData = await metricsResponse.json();
      results.availableMetrics = (metricsData.metricDescriptors || []).map((m: MetricDescriptor) => ({
        type: m.type,
        labels: m.labels?.map((l: { key: string }) => l.key),
      }));
    } else {
      results.metricsError = await metricsResponse.text();
    }

    // 2. Query for ALL api/request_count data to see what services exist
    const now = new Date();
    const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const timeSeriesUrl = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?` +
      `filter=${encodeURIComponent('metric.type = "serviceruntime.googleapis.com/api/request_count"')}&` +
      `interval.startTime=${day30Ago.toISOString()}&` +
      `interval.endTime=${now.toISOString()}&` +
      `aggregation.alignmentPeriod=2592000s&` + // 30 days
      `aggregation.perSeriesAligner=ALIGN_SUM&` +
      `aggregation.crossSeriesReducer=REDUCE_SUM&` +
      `aggregation.groupByFields=resource.labels.service`;

    const timeSeriesResponse = await fetch(timeSeriesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (timeSeriesResponse.ok) {
      const tsData = await timeSeriesResponse.json();
      const serviceBreakdown: Record<string, number> = {};

      if (tsData.timeSeries) {
        for (const series of tsData.timeSeries as TimeSeriesData[]) {
          const service = series.resource?.labels?.service || "unknown";
          const count = series.points?.[0]?.value?.int64Value || "0";
          serviceBreakdown[service] = (serviceBreakdown[service] || 0) + parseInt(count, 10);
        }
      }

      results.serviceBreakdown = serviceBreakdown;
      results.totalRequests = Object.values(serviceBreakdown).reduce((a, b) => a + b, 0);
    } else {
      results.timeSeriesError = await timeSeriesResponse.text();
    }

    // 3. Also query with method breakdown for each service
    const methodBreakdownUrl = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?` +
      `filter=${encodeURIComponent('metric.type = "serviceruntime.googleapis.com/api/request_count"')}&` +
      `interval.startTime=${day30Ago.toISOString()}&` +
      `interval.endTime=${now.toISOString()}&` +
      `aggregation.alignmentPeriod=2592000s&` +
      `aggregation.perSeriesAligner=ALIGN_SUM&` +
      `aggregation.crossSeriesReducer=REDUCE_SUM&` +
      `aggregation.groupByFields=resource.labels.service,metric.labels.method`;

    const methodResponse = await fetch(methodBreakdownUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (methodResponse.ok) {
      const methodData = await methodResponse.json();
      const methodBreakdown: Record<string, Record<string, number>> = {};

      if (methodData.timeSeries) {
        for (const series of methodData.timeSeries as TimeSeriesData[]) {
          const service = series.resource?.labels?.service || "unknown";
          const method = series.metric?.labels?.method || "unknown";
          const count = parseInt(series.points?.[0]?.value?.int64Value || "0", 10);

          if (!methodBreakdown[service]) {
            methodBreakdown[service] = {};
          }
          methodBreakdown[service][method] = (methodBreakdown[service][method] || 0) + count;
        }
      }

      results.methodBreakdown = methodBreakdown;
    }

    // 4. Try to get billing data directly from Cloud Billing API
    // List billing accounts the service account has access to
    const billingUrl = "https://cloudbilling.googleapis.com/v1/billingAccounts";
    const billingResponse = await fetch(billingUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (billingResponse.ok) {
      const billingData = await billingResponse.json();
      results.billingAccounts = billingData.billingAccounts || [];
    } else {
      const billingError = await billingResponse.text();
      results.billingError = `Cannot access Cloud Billing API: ${billingError}`;
      results.billingNote = "To get actual billing data, you need to either: (1) Grant the service account 'Billing Account Viewer' role, or (2) Set up BigQuery billing export";
    }

    // 5. Check what APIs are enabled
    const servicesUrl = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services?filter=state:ENABLED`;
    const servicesResponse = await fetch(servicesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (servicesResponse.ok) {
      const servicesData = await servicesResponse.json();
      const mapsApis = (servicesData.services || [])
        .map((s: { config?: { name?: string; title?: string } }) => ({
          name: s.config?.name,
          title: s.config?.title,
        }))
        .filter((s: { name?: string }) =>
          s.name?.includes("maps") ||
          s.name?.includes("places") ||
          s.name?.includes("geocoding") ||
          s.name?.includes("routes") ||
          s.name?.includes("distance")
        );
      results.enabledMapsApis = mapsApis;
    } else {
      results.servicesError = await servicesResponse.text();
    }

    // 6. Summary and recommendations
    results.recommendations = [];

    if (results.serviceBreakdown && Object.keys(results.serviceBreakdown as object).length > 0) {
      const breakdown = results.serviceBreakdown as Record<string, number>;
      results.recommendations = [
        "Services found in Cloud Monitoring. Compare these counts with Google Cloud Console.",
        `Total requests in last 30 days: ${results.totalRequests}`,
        "Service breakdown:",
        ...Object.entries(breakdown).map(([service, count]) => `  - ${service}: ${count.toLocaleString()} requests`),
      ];
    } else {
      (results.recommendations as string[]).push(
        "No request count data found. Possible reasons:",
        "1. The service account may not have 'Monitoring Viewer' role",
        "2. No API calls have been made in the last 30 days",
        "3. The project ID might be wrong"
      );
    }

    return apiSuccess(results);
  } catch (error) {
    console.error("[Google Debug] Error:", error);
    return errors.internal(
      `Debug endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
      "Google Debug"
    );
  }
}
