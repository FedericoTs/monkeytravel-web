/**
 * OAuth Authorization Server Metadata
 * Redirects to Supabase's OAuth 2.1 server metadata
 *
 * This endpoint tells MCP clients where to find Supabase's OAuth endpoints:
 * - authorization_endpoint
 * - token_endpoint
 * - registration_endpoint (for Dynamic Client Registration)
 */

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function GET() {
  // Fetch Supabase's OAuth server metadata and return it
  try {
    const response = await fetch(
      `${SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`,
      {
        headers: {
          Accept: "application/json",
        },
        // Cache for 1 hour
        next: { revalidate: 3600 },
      }
    );

    if (!response.ok) {
      // If Supabase doesn't have OAuth enabled yet, return a placeholder
      // This will be updated once OAuth is enabled in the dashboard
      return NextResponse.json(
        {
          error: "oauth_not_enabled",
          message:
            "OAuth 2.1 server is not yet enabled. Please enable it in Supabase Dashboard > Authentication > OAuth Server",
        },
        { status: 503 }
      );
    }

    const metadata = await response.json();

    return NextResponse.json(metadata, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[OAuth Metadata Error]", error);
    return NextResponse.json(
      {
        error: "metadata_fetch_failed",
        message: "Failed to fetch OAuth authorization server metadata",
      },
      { status: 500 }
    );
  }
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
