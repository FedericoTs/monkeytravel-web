import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEarlyAccessStatus } from "@/lib/early-access";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const status = await getEarlyAccessStatus(user.id, user.email);

    return NextResponse.json(status);
  } catch (error) {
    console.error("[EarlyAccess] Error getting status:", error);
    return NextResponse.json(
      { error: "Failed to get early access status" },
      { status: 500 }
    );
  }
}
