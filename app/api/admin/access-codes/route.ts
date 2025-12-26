import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

// Generate a random code
function generateCode(length: number = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No O, 0, I, 1 to avoid confusion
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET - List all access codes
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return errors.unauthorized();
    }

    // Get all codes with redemption count
    const { data: codes, error } = await supabase
      .from("tester_codes")
      .select(`
        *,
        redemptions:user_tester_access(count)
      `)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Get code usage stats
    const { data: usageStats } = await supabase
      .from("user_tester_access")
      .select("code_id, ai_generations_used, ai_regenerations_used, ai_assistant_used");

    // Aggregate usage by code
    const usageByCode: Record<string, {
      generations: number;
      regenerations: number;
      assistant: number;
    }> = {};

    usageStats?.forEach((usage) => {
      if (!usageByCode[usage.code_id]) {
        usageByCode[usage.code_id] = { generations: 0, regenerations: 0, assistant: 0 };
      }
      usageByCode[usage.code_id].generations += usage.ai_generations_used || 0;
      usageByCode[usage.code_id].regenerations += usage.ai_regenerations_used || 0;
      usageByCode[usage.code_id].assistant += usage.ai_assistant_used || 0;
    });

    // Enrich codes with usage data
    const enrichedCodes = codes?.map((code) => ({
      ...code,
      usage: usageByCode[code.id] || { generations: 0, regenerations: 0, assistant: 0 },
    }));

    return apiSuccess({ codes: enrichedCodes });
  } catch (error) {
    console.error("[Access Codes] Error fetching codes:", error);
    return errors.internal("Failed to fetch access codes", "Access Codes");
  }
}

// POST - Create a new access code
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return errors.unauthorized();
    }

    const body = await request.json();
    const {
      code: customCode,
      display_name,
      ai_generations_limit,
      ai_regenerations_limit,
      ai_assistant_limit,
      max_uses,
      expires_at,
      notes,
    } = body;

    // Generate code if not provided
    const code = customCode?.trim().toUpperCase() || generateCode();

    // Validate code format
    if (!/^[A-Z0-9]{4,20}$/.test(code)) {
      return errors.badRequest("Code must be 4-20 alphanumeric characters");
    }

    // Check if code already exists
    const { data: existing } = await supabase
      .from("tester_codes")
      .select("id")
      .eq("code", code)
      .single();

    if (existing) {
      return errors.badRequest("Code already exists");
    }

    // Create the code
    const { data: newCode, error } = await supabase
      .from("tester_codes")
      .insert({
        code,
        display_name: display_name || null,
        ai_generations_limit: ai_generations_limit ?? null,
        ai_regenerations_limit: ai_regenerations_limit ?? null,
        ai_assistant_limit: ai_assistant_limit ?? null,
        max_uses: max_uses ?? null,
        expires_at: expires_at || null,
        notes: notes || null,
        created_by: user.id,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return apiSuccess({
      success: true,
      code: newCode,
    });
  } catch (error) {
    console.error("[Access Codes] Error creating code:", error);
    return errors.internal("Failed to create access code", "Access Codes");
  }
}

// PATCH - Update an access code
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return errors.unauthorized();
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return errors.badRequest("Code ID required");
    }

    // Update the code
    const { data: updatedCode, error } = await supabase
      .from("tester_codes")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return apiSuccess({
      success: true,
      code: updatedCode,
    });
  } catch (error) {
    console.error("[Access Codes] Error updating code:", error);
    return errors.internal("Failed to update access code", "Access Codes");
  }
}

// DELETE - Delete an access code
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return errors.unauthorized();
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return errors.badRequest("Code ID required");
    }

    // Delete user access records first
    await supabase
      .from("user_tester_access")
      .delete()
      .eq("code_id", id);

    // Delete the code
    const { error } = await supabase
      .from("tester_codes")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[Access Codes] Error deleting code:", error);
    return errors.internal("Failed to delete access code", "Access Codes");
  }
}
