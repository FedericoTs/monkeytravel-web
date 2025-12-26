import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redeemTesterCode, validateCode } from "@/lib/early-access";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized("You must be logged in to redeem a code");
    }

    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== "string") {
      return errors.badRequest("Please enter a valid code");
    }

    // Validate code format (alphanumeric, 4-20 chars)
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(normalizedCode)) {
      return errors.badRequest("Invalid code format");
    }

    const result = await redeemTesterCode(user.id, normalizedCode);

    if (!result.success) {
      return errors.badRequest(result.error);
    }

    return apiSuccess({
      success: true,
      message: "Code redeemed successfully! You now have early access.",
      access: result.access,
    });
  } catch (error) {
    console.error("[Early Access] Error redeeming code:", error);
    return errors.internal("Failed to redeem code. Please try again.", "Early Access");
  }
}

// Validate a code without redeeming
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    if (!code) {
      return errors.badRequest("No code provided");
    }

    const result = await validateCode(code);
    return apiSuccess(result);
  } catch (error) {
    console.error("[Early Access] Error validating code:", error);
    return errors.internal("Failed to validate code", "Early Access");
  }
}
