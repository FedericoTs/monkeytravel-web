/**
 * MCP Server Endpoint for ChatGPT Integration
 *
 * Implements MCP with SSE (Server-Sent Events) transport for ChatGPT
 *
 * AUTHENTICATION: None required (public access for acquisition)
 * - Rate limiting by IP prevents abuse
 * - Users can save trips via /from-chatgpt/[ref] (requires login there)
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 * @see https://developers.openai.com/apps-sdk
 */

import { NextRequest } from "next/server";
import { GenerateTripInputSchema, MCP_TOOL_DEFINITION } from "@/lib/mcp/schema";
import { generateMCPTrip } from "@/lib/mcp/generate";
import { generateItineraryWidget } from "@/lib/mcp/widget";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MCP_VERSION = "2025-03-26";
const SERVER_INFO = {
  name: "MonkeyTravel",
  version: "1.0.0",
};

// Rate limit: 20 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW = 60 * 1000;

// Session management
const sessions = new Map<string, { createdAt: number }>();

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

/**
 * Create SSE response with JSON-RPC message
 */
function createSSEResponse(data: object, sessionId?: string, origin?: string): Response {
  const sseData = `data: ${JSON.stringify(data)}\n\n`;

  // Determine CORS origin
  const allowedOrigins = [
    "https://chatgpt.com",
    "https://chat.openai.com",
    "https://platform.openai.com",
  ];
  const corsOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
  };

  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  return new Response(sseData, { headers });
}

/**
 * Create JSON-RPC response
 */
function jsonRpcResponse(id: string | number | null, result: object) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

/**
 * Create JSON-RPC error response
 */
function jsonRpcError(id: string | number | null, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET /api/mcp - SSE endpoint for server-initiated messages
 */
export async function GET(request: NextRequest) {
  const accept = request.headers.get("Accept") || "";

  // Check if client wants SSE
  if (accept.includes("text/event-stream")) {
    // Return SSE stream (keep-alive for server notifications)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial ping
        controller.enqueue(encoder.encode(": ping\n\n"));

        // Keep connection alive with periodic pings
        const interval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            clearInterval(interval);
          }
        }, 30000);

        // Clean up on close
        request.signal.addEventListener("abort", () => {
          clearInterval(interval);
          controller.close();
        });
      },
    });

    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = [
      "https://chatgpt.com",
      "https://chat.openai.com",
      "https://platform.openai.com",
    ];
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": corsOrigin,
      },
    });
  }

  // Return server info for non-SSE GET requests
  return new Response(
    JSON.stringify({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocolVersion: MCP_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

/**
 * POST /api/mcp - Main MCP JSON-RPC handler with SSE response
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const origin = request.headers.get("Origin") || undefined;

  try {
    // Rate limiting
    const ip = getClientIP(request);
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return createSSEResponse(
        jsonRpcError(null, -32000, "Rate limit exceeded. Try again in 60 seconds."),
        undefined,
        origin
      );
    }

    // Parse JSON-RPC request
    const body = await request.json();
    const { method, params, id } = body;

    // Get or create session
    let sessionId = request.headers.get("Mcp-Session-Id");

    console.log("[MCP Request]", { requestId, method, id, ip, sessionId, origin });

    // Handle JSON-RPC methods
    switch (method) {
      // Initialize session
      case "initialize": {
        sessionId = crypto.randomUUID();
        sessions.set(sessionId, { createdAt: Date.now() });

        return createSSEResponse(
          jsonRpcResponse(id, {
            protocolVersion: MCP_VERSION,
            serverInfo: SERVER_INFO,
            capabilities: {
              tools: { listChanged: false },
            },
          }),
          sessionId,
          origin
        );
      }

      // List available tools
      case "tools/list": {
        return createSSEResponse(
          jsonRpcResponse(id, {
            tools: [MCP_TOOL_DEFINITION],
          }),
          sessionId || undefined,
          origin
        );
      }

      // Execute a tool
      case "tools/call": {
        const toolName = params?.name;
        const toolArgs = params?.arguments;

        if (toolName !== "generate_trip") {
          return createSSEResponse(
            jsonRpcError(id, -32601, `Unknown tool: ${toolName}`),
            undefined,
            origin
          );
        }

        // Validate input
        const parseResult = GenerateTripInputSchema.safeParse(toolArgs);
        if (!parseResult.success) {
          return createSSEResponse(
            jsonRpcError(
              id,
              -32602,
              parseResult.error.issues.map((i) => i.message).join(", ")
            ),
            undefined,
            origin
          );
        }

        // Generate trip
        const trip = await generateMCPTrip(parseResult.data);
        const widgetHtml = generateItineraryWidget(trip);

        console.log("[MCP Response]", {
          requestId,
          tripId: trip.id,
          destination: trip.destination,
          days: trip.days,
          duration: Date.now() - startTime,
        });

        return createSSEResponse(
          jsonRpcResponse(id, {
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
          }),
          sessionId || undefined,
          origin
        );
      }

      // Notifications (no response needed)
      case "notifications/initialized":
      case "notifications/cancelled": {
        return new Response(null, { status: 202 });
      }

      // Unknown method
      default: {
        return createSSEResponse(
          jsonRpcError(id, -32601, `Method not found: ${method}`),
          undefined,
          origin
        );
      }
    }
  } catch (error) {
    console.error("[MCP Error]", { requestId, error });

    return createSSEResponse(
      jsonRpcError(null, -32603, error instanceof Error ? error.message : "Internal error"),
      undefined,
      origin
    );
  }
}

/**
 * DELETE /api/mcp - Terminate session
 */
export async function DELETE(request: NextRequest) {
  const sessionId = request.headers.get("Mcp-Session-Id");

  if (sessionId) {
    sessions.delete(sessionId);
  }

  return new Response(null, { status: 204 });
}

/**
 * OPTIONS /api/mcp - CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("Origin") || "*";

  // Allow ChatGPT origins specifically
  const allowedOrigins = [
    "https://chatgpt.com",
    "https://chat.openai.com",
    "https://platform.openai.com",
  ];

  const corsOrigin = allowedOrigins.includes(origin) ? origin : "*";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
      "Access-Control-Max-Age": "86400",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}
