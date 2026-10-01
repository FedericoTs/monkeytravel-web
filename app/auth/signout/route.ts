import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Use the request origin to build the redirect URL (works in all environments)
  const origin = request.headers.get("origin") || request.nextUrl.origin;
  // 303, not the default 307: a 307 makes the browser repeat the POST on the
  // home page, which answers 405 with an empty page.
  return NextResponse.redirect(new URL("/", origin), 303);
}
