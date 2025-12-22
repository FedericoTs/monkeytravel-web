/**
 * MCP Server Endpoint for ChatGPT Integration
 *
 * This endpoint implements the Model Context Protocol (MCP) for ChatGPT
 * to generate travel itineraries using our existing Gemini AI infrastructure.
 *
 * IMPORTANT: This is a NEW file - does not modify existing code
 *
 * @see https://developers.openai.com/apps-sdk
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GenerateTripInputSchema, MCP_TOOL_DEFINITION } from "@/lib/mcp/schema";
import { generateMCPTrip } from "@/lib/mcp/generate";
import { generateItineraryWidget } from "@/lib/mcp/widget";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MCP_VERSION = "1.0.0";

// Rate limit: 10 requests per minute per IP (simple in-memory, resets on deploy)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// ============================================================================
// HELPERS
// ============================================================================

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (record.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT - record.count };
}

interface AuthResult {
  valid: boolean;
  userId?: string;
  method: "api_key" | "oauth" | "open";
}

async function validateAuth(request: NextRequest): Promise<AuthResult> {
  // Check for API key first
  const apiKey = request.headers.get("X-API-Key");
  const expectedKey = process.env.MCP_API_KEY;

  if (apiKey && expectedKey && apiKey === expectedKey) {
    return { valid: true, method: "api_key" };
  }

  // Check for OAuth Bearer token
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);

    try {
      // Verify token with Supabase
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        console.warn("[MCP OAuth] Invalid token:", error?.message);
        return { valid: false, method: "oauth" };
      }

      return { valid: true, userId: user.id, method: "oauth" };
    } catch (e) {
      console.error("[MCP OAuth] Token verification error:", e);
      return { valid: false, method: "oauth" };
    }
  }

  // If no MCP_API_KEY is set, allow all requests (dev mode)
  if (!expectedKey) {
    console.warn("[MCP] No MCP_API_KEY set - running in open mode");
    return { valid: true, method: "open" };
  }

  return { valid: false, method: "api_key" };
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET /api/mcp - Health check and server info
 */
export async function GET() {
  return NextResponse.json({
    status: "healthy",
    version: MCP_VERSION,
    name: "MonkeyTravel MCP Server",
    description: "AI-powered travel itinerary generation",
    tools: [MCP_TOOL_DEFINITION.name],
  });
}

/**
 * POST /api/mcp - Main MCP protocol handler
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 1. Authentication (supports both API key and OAuth Bearer token)
    const auth = await validateAuth(request);
    if (!auth.valid) {
      // Return WWW-Authenticate header for OAuth clients
      return NextResponse.json(
        {
          error: "unauthorized",
          message: "Invalid or missing authentication",
          _meta: {
            "mcp/www_authenticate": [
              `Bearer resource_metadata="https://monkeytravel.app/.well-known/oauth-protected-resource"`,
            ],
          },
        },
        {
          status: 401,
          headers: {
            "X-Request-ID": requestId,
            "WWW-Authenticate": `Bearer resource_metadata="https://monkeytravel.app/.well-known/oauth-protected-resource"`,
          },
        }
      );
    }

    // 2. Rate limiting
    const ip = getClientIP(request);
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "rate_limit_exceeded", message: "Too many requests" },
        {
          status: 429,
          headers: {
            "X-Request-ID": requestId,
            "Retry-After": "60",
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    // 3. Parse request body
    const body = await request.json();
    const method = body.method as string;

    console.log("[MCP Request]", {
      requestId,
      method,
      ip,
      authMethod: auth.method,
      userId: auth.userId,
    });

    // 4. Handle MCP methods
    switch (method) {
      // List available tools
      case "tools/list": {
        return NextResponse.json(
          { tools: [MCP_TOOL_DEFINITION] },
          {
            headers: {
              "X-Request-ID": requestId,
              "X-RateLimit-Remaining": String(rateLimit.remaining),
            },
          }
        );
      }

      // Execute a tool
      case "tools/call": {
        const toolName = body.params?.name;
        const toolArgs = body.params?.arguments;

        if (toolName !== "generate_trip") {
          return NextResponse.json(
            { error: "unknown_tool", message: `Tool '${toolName}' not found` },
            { status: 400, headers: { "X-Request-ID": requestId } }
          );
        }

        // Validate input
        const parseResult = GenerateTripInputSchema.safeParse(toolArgs);
        if (!parseResult.success) {
          return NextResponse.json(
            {
              error: "invalid_input",
              message: parseResult.error.issues
                .map((i) => i.message)
                .join(", "),
            },
            { status: 400, headers: { "X-Request-ID": requestId } }
          );
        }

        // Generate trip
        const trip = await generateMCPTrip(parseResult.data);

        // Generate widget HTML
        const widgetHtml = generateItineraryWidget(trip);

        // Return MCP response with widget
        const response = {
          content: [
            {
              type: "text",
              text: trip.summary,
            },
            {
              type: "resource",
              resource: {
                uri: `widget://itinerary/${trip.id}`,
                mimeType: "text/html",
                text: widgetHtml,
              },
            },
          ],
        };

        console.log("[MCP Response]", {
          requestId,
          tripId: trip.id,
          destination: trip.destination,
          days: trip.days,
          duration: Date.now() - startTime,
        });

        return NextResponse.json(response, {
          headers: {
            "X-Request-ID": requestId,
            "X-RateLimit-Remaining": String(rateLimit.remaining),
          },
        });
      }

      // Unknown method
      default: {
        return NextResponse.json(
          { error: "unknown_method", message: `Method '${method}' not supported` },
          { status: 400, headers: { "X-Request-ID": requestId } }
        );
      }
    }
  } catch (error) {
    console.error("[MCP Error]", { requestId, error });

    return NextResponse.json(
      {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error",
        request_id: requestId,
      },
      { status: 500, headers: { "X-Request-ID": requestId } }
    );
  }
}

/**
 * OPTIONS /api/mcp - CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
