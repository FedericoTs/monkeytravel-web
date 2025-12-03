import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateItinerary, validateTripParams } from "@/lib/gemini";
import type { TripCreationParams } from "@/types";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const params: TripCreationParams = {
      destination: body.destination,
      startDate: body.startDate,
      endDate: body.endDate,
      budgetTier: body.budgetTier || "balanced",
      pace: body.pace || "moderate",
      vibes: body.vibes || [],
      seasonalContext: body.seasonalContext,
      interests: body.interests || [],
      requirements: body.requirements,
    };

    // Validate input
    const validation = validateTripParams(params);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Check rate limits (simple version - 10 generations per day per user)
    const today = new Date().toISOString().split("T")[0];
    const { count } = await supabase
      .from("api_request_logs")
      .select("*", { count: "exact", head: true })
      .eq("api_name", "gemini")
      .gte("timestamp", `${today}T00:00:00Z`)
      .eq("request_params->>user_id", user.id);

    if ((count || 0) >= 10) {
      return NextResponse.json(
        { error: "Daily generation limit reached. Try again tomorrow." },
        { status: 429 }
      );
    }

    // Generate itinerary
    const itinerary = await generateItinerary(params);
    const generationTime = Date.now() - startTime;

    // Log the request
    await supabase.from("api_request_logs").insert({
      api_name: "gemini",
      endpoint: "/api/ai/generate",
      request_params: {
        user_id: user.id,
        destination: params.destination,
        vibes: params.vibes,
        duration:
          Math.ceil(
            (new Date(params.endDate).getTime() -
              new Date(params.startDate).getTime()) /
              (1000 * 60 * 60 * 24)
          ) + 1,
      },
      response_status: 200,
      response_time_ms: generationTime,
      cache_hit: false,
      cost_usd: 0.003, // Estimated cost for gemini-2.0-flash
    });

    return NextResponse.json({
      success: true,
      itinerary,
      meta: {
        generationTimeMs: generationTime,
        model: "gemini-2.0-flash",
      },
    });
  } catch (error) {
    console.error("Generation error:", error);

    // Log error
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("api_request_logs").insert({
      api_name: "gemini",
      endpoint: "/api/ai/generate",
      request_params: { user_id: user?.id },
      response_status: 500,
      response_time_ms: Date.now() - startTime,
      error_message: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Failed to generate itinerary. Please try again." },
      { status: 500 }
    );
  }
}
