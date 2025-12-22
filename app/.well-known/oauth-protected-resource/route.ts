/**
 * OAuth Protected Resource Metadata
 * Required for MCP OAuth flow - tells clients where to authenticate
 *
 * OpenAI Apps SDK queries this endpoint to discover:
 * - Which authorization server to use
 * - What scopes are supported
 * - Resource documentation
 */

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const MCP_SERVER_URL = "https://monkeytravel.app";

export async function GET() {
  const metadata = {
    // The resource server (our MCP server)
    resource: `${MCP_SERVER_URL}/api/mcp`,

    // Authorization servers that can issue tokens for this resource
    // Points to Supabase's OAuth 2.1 server
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],

    // Scopes our MCP server supports
    scopes_supported: ["openid", "email", "profile"],

    // Documentation about the MCP server
    resource_documentation: `${MCP_SERVER_URL}/docs/mcp`,

    // Bearer token method
    bearer_methods_supported: ["header"],
  };

  return NextResponse.json(metadata, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
