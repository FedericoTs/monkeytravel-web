import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redeemTesterCode, validateCode } from "@/lib/early-access";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "You must be logged in to redeem a code" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "Please enter a valid code" },
        { status: 400 }
      );
    }

    // Validate code format (alphanumeric, 4-20 chars)
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(normalizedCode)) {
      return NextResponse.json(
        { error: "Invalid code format" },
        { status: 400 }
      );
    }

    const result = await redeemTesterCode(user.id, normalizedCode);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Code redeemed successfully! You now have early access.",
      access: result.access,
    });
  } catch (error) {
    console.error("[EarlyAccess] Error redeeming code:", error);
    return NextResponse.json(
      { error: "Failed to redeem code. Please try again." },
      { status: 500 }
    );
  }
}

// Validate a code without redeeming
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { valid: false, error: "No code provided" },
        { status: 400 }
      );
    }

    const result = await validateCode(code);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[EarlyAccess] Error validating code:", error);
    return NextResponse.json(
      { valid: false, error: "Failed to validate code" },
      { status: 500 }
    );
  }
}
