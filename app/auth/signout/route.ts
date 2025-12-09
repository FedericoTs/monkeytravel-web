import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Use the request origin to build the redirect URL (works in all environments)
  const origin = request.headers.get("origin") || request.nextUrl.origin;
  return NextResponse.redirect(new URL("/", origin));
}
