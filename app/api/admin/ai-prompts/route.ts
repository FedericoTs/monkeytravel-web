/**
 * AI Prompts Admin Endpoint
 *
 * GET - Retrieve all AI prompts
 * PATCH - Update an AI prompt
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

export interface AiPrompt {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  prompt_text: string;
  category: string;
  is_active: boolean;
  version: number;
  token_estimate: number | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  metadata: Record<string, unknown>;
}

/**
 * GET /api/admin/ai-prompts
 * Retrieve all AI prompts
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch all AI prompts
    const { data, error } = await supabase
      .from("ai_prompts")
      .select("*")
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("[AiPrompts] Failed to fetch:", error);
      // Return empty array if table doesn't exist yet
      if (error.code === "42P01") {
        return NextResponse.json({ prompts: [], tableExists: false });
      }
      return NextResponse.json(
        { error: "Failed to fetch AI prompts" },
        { status: 500 }
      );
    }

    return NextResponse.json({ prompts: data || [], tableExists: true });
  } catch (error) {
    console.error("[AiPrompts] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/ai-prompts
 * Update an AI prompt
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { id, name, prompt_text, is_active, description, token_estimate } = body;

    if (!id && !name) {
      return NextResponse.json(
        { error: "id or name is required" },
        { status: 400 }
      );
    }

    // Get current prompt to increment version
    const { data: currentPrompt, error: fetchError } = await supabase
      .from("ai_prompts")
      .select("version")
      .eq(id ? "id" : "name", id || name)
      .single();

    if (fetchError) {
      console.error("[AiPrompts] Failed to fetch current prompt:", fetchError);
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    // Build update object
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: user.email,
      version: (currentPrompt?.version || 0) + 1,
    };

    if (typeof prompt_text === "string") {
      updates.prompt_text = prompt_text;
      // Estimate tokens (~4 chars per token)
      updates.token_estimate = Math.ceil(prompt_text.length / 4);
    }

    if (typeof is_active === "boolean") {
      updates.is_active = is_active;
    }

    if (typeof description === "string") {
      updates.description = description;
    }

    if (typeof token_estimate === "number") {
      updates.token_estimate = token_estimate;
    }

    // Update the prompt
    const { data, error } = await supabase
      .from("ai_prompts")
      .update(updates)
      .eq(id ? "id" : "name", id || name)
      .select()
      .single();

    if (error) {
      console.error("[AiPrompts] Failed to update:", error);
      return NextResponse.json(
        { error: "Failed to update AI prompt" },
        { status: 500 }
      );
    }

    console.log(`[AiPrompts] Updated ${data.name} (v${data.version}) by ${user.email}`);

    return NextResponse.json({
      success: true,
      prompt: data,
      message: `${data.display_name} updated to version ${data.version}`,
    });
  } catch (error) {
    console.error("[AiPrompts] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/ai-prompts
 * Create a new AI prompt or perform actions
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { action, name, display_name, prompt_text, category, description } = body;

    // Handle revert to default action
    if (action === "revert_to_default") {
      const { data, error } = await supabase
        .from("ai_prompts")
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
          updated_by: user.email,
        })
        .eq("name", name)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: "Failed to revert" }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `${data.display_name} will now use the default hardcoded prompt`,
      });
    }

    // Handle activate action
    if (action === "activate") {
      const { data, error } = await supabase
        .from("ai_prompts")
        .update({
          is_active: true,
          updated_at: new Date().toISOString(),
          updated_by: user.email,
        })
        .eq("name", name)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: "Failed to activate" }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `${data.display_name} is now active`,
      });
    }

    // Create new prompt
    if (!name || !display_name || !prompt_text) {
      return NextResponse.json(
        { error: "name, display_name, and prompt_text are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("ai_prompts")
      .insert({
        name,
        display_name,
        description: description || null,
        prompt_text,
        category: category || "custom",
        is_active: true,
        version: 1,
        token_estimate: Math.ceil(prompt_text.length / 4),
        updated_by: user.email,
      })
      .select()
      .single();

    if (error) {
      console.error("[AiPrompts] Failed to create:", error);
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "A prompt with this name already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to create AI prompt" },
        { status: 500 }
      );
    }

    console.log(`[AiPrompts] Created ${data.name} by ${user.email}`);

    return NextResponse.json({
      success: true,
      prompt: data,
      message: `${data.display_name} created successfully`,
    });
  } catch (error) {
    console.error("[AiPrompts] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
