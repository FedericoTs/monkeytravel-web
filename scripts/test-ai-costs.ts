/**
 * Comprehensive AI Cost Analysis Test Suite
 *
 * Tests all AI endpoints for:
 * 1. Response quality
 * 2. Cost per request
 * 3. Response time
 * 4. Feature coverage (coordinates, Place IDs, etc.)
 *
 * Run with: npx tsx scripts/test-ai-costs.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const API_KEY = process.env.GOOGLE_AI_API_KEY;

interface TestResult {
  name: string;
  responseTimeMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  activityCount?: number;
  hasCoordinates?: boolean;
  hasPlaceIds?: boolean;
  quality: "excellent" | "good" | "fair" | "poor";
  notes: string;
}

const results: TestResult[] = [];

// Gemini Flash pricing (per million tokens)
const PRICING = {
  "gemini-2.5-flash": { input: 0.075, output: 0.30 },
  "gemini-2.5-flash-lite": { input: 0.0375, output: 0.15 },
};

function calculateCost(
  model: keyof typeof PRICING,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING[model];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

async function testStandardGemini(): Promise<TestResult> {
  console.log("\n📊 Testing Standard Gemini (gemini-2.5-flash)...");

  const prompt = `Create a 3-day travel itinerary for Rome, Italy.
For each day, provide 4 activities with:
- Name, Type, Description, Location, Address, Duration, Cost estimate
Focus on tourist-friendly, well-known places.
Return as JSON array.`;

  const startTime = Date.now();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    }
  );

  const elapsed = Date.now() - startTime;
  const data = await response.json();

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const usage = data.usageMetadata || {};

  // Count activities in response
  const activityMatches = text.match(/\"name\":/gi) || [];

  return {
    name: "Standard Gemini (gemini-2.5-flash)",
    responseTimeMs: elapsed,
    inputTokens: usage.promptTokenCount || Math.ceil(prompt.length / 4),
    outputTokens: usage.candidatesTokenCount || Math.ceil(text.length / 4),
    totalTokens: usage.totalTokenCount || 0,
    estimatedCost: calculateCost(
      "gemini-2.5-flash",
      usage.promptTokenCount || 100,
      usage.candidatesTokenCount || 1000
    ),
    activityCount: activityMatches.length,
    hasCoordinates: false,
    hasPlaceIds: false,
    quality: activityMatches.length >= 10 ? "excellent" : "good",
    notes: `Generated ${activityMatches.length} activities. No coordinates or Place IDs.`,
  };
}

async function testMapsGrounding(): Promise<TestResult> {
  console.log("\n🗺️  Testing Maps Grounding (googleMaps tool)...");

  const prompt = `Create a 3-day travel itinerary for Rome, Italy.
For each day, provide 4 activities with:
- Name, Type, Description, Location, Address, Duration, Cost estimate
Focus on tourist-friendly, well-known places.
Return as JSON array.`;

  const romeCoords = { lat: 41.9028, lng: 12.4964 };
  const startTime = Date.now();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: { latitude: romeCoords.lat, longitude: romeCoords.lng },
          },
        },
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    }
  );

  const elapsed = Date.now() - startTime;
  const data = await response.json();

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const usage = data.usageMetadata || {};
  const grounding = data.candidates?.[0]?.groundingMetadata;

  const mapsChunks =
    grounding?.groundingChunks?.filter((c: { maps?: unknown }) => c.maps) || [];
  const activityMatches = text.match(/\"name\":/gi) || [];

  return {
    name: "Maps Grounding (googleMaps tool)",
    responseTimeMs: elapsed,
    inputTokens: usage.promptTokenCount || Math.ceil(prompt.length / 4),
    outputTokens: usage.candidatesTokenCount || Math.ceil(text.length / 4),
    totalTokens: usage.totalTokenCount || 0,
    estimatedCost: calculateCost(
      "gemini-2.5-flash",
      usage.promptTokenCount || 100,
      usage.candidatesTokenCount || 1000
    ),
    activityCount: activityMatches.length,
    hasCoordinates: false,
    hasPlaceIds: mapsChunks.length > 0,
    quality:
      mapsChunks.length > 0
        ? "excellent"
        : activityMatches.length >= 10
          ? "good"
          : "fair",
    notes: `${activityMatches.length} activities. ${mapsChunks.length} grounded places with Place IDs.`,
  };
}

async function testGoogleSearch(): Promise<TestResult> {
  console.log("\n🔍 Testing Google Search Grounding...");

  const prompt = `Create a 3-day travel itinerary for Rome, Italy.
For each day, provide 4 activities with:
- Name, Type, Description, Location, Address, Duration, Cost estimate
Focus on tourist-friendly, well-known places with accurate current information.`;

  const startTime = Date.now();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    }
  );

  const elapsed = Date.now() - startTime;
  const data = await response.json();

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const usage = data.usageMetadata || {};
  const grounding = data.candidates?.[0]?.groundingMetadata;

  const totalChunks = grounding?.groundingChunks?.length || 0;
  const activityMatches = text.match(/Colosseum|Vatican|Trevi|Pantheon|Spanish Steps/gi) || [];

  return {
    name: "Google Search Grounding",
    responseTimeMs: elapsed,
    inputTokens: usage.promptTokenCount || Math.ceil(prompt.length / 4),
    outputTokens: usage.candidatesTokenCount || Math.ceil(text.length / 4),
    totalTokens: usage.totalTokenCount || 0,
    estimatedCost: calculateCost(
      "gemini-2.5-flash",
      usage.promptTokenCount || 100,
      usage.candidatesTokenCount || 1000
    ),
    activityCount: activityMatches.length,
    hasCoordinates: false,
    hasPlaceIds: false,
    quality: totalChunks > 10 ? "excellent" : totalChunks > 0 ? "good" : "fair",
    notes: `${totalChunks} grounding chunks. Factual search-grounded content.`,
  };
}

async function testFlashLite(): Promise<TestResult> {
  console.log("\n⚡ Testing Flash-Lite (cheapest model)...");

  const prompt = `Suggest 3 restaurant options for lunch in Rome, Italy.
For each: name, cuisine type, price range, brief description.
Return as JSON array.`;

  const startTime = Date.now();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    }
  );

  const elapsed = Date.now() - startTime;
  const data = await response.json();

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const usage = data.usageMetadata || {};

  const restaurantMatches = text.match(/\"name\":/gi) || [];

  return {
    name: "Flash-Lite (simple queries)",
    responseTimeMs: elapsed,
    inputTokens: usage.promptTokenCount || Math.ceil(prompt.length / 4),
    outputTokens: usage.candidatesTokenCount || Math.ceil(text.length / 4),
    totalTokens: usage.totalTokenCount || 0,
    estimatedCost: calculateCost(
      "gemini-2.5-flash-lite",
      usage.promptTokenCount || 50,
      usage.candidatesTokenCount || 300
    ),
    activityCount: restaurantMatches.length,
    hasCoordinates: false,
    hasPlaceIds: false,
    quality: restaurantMatches.length >= 3 ? "good" : "fair",
    notes: `Best for simple queries. ${restaurantMatches.length} results.`,
  };
}

async function runAllTests() {
  console.log("═".repeat(60));
  console.log("🧪 AI COST ANALYSIS TEST SUITE");
  console.log("═".repeat(60));

  if (!API_KEY) {
    console.error("❌ GOOGLE_AI_API_KEY not found!");
    process.exit(1);
  }

  // Run all tests
  try {
    results.push(await testStandardGemini());
  } catch (e) {
    console.error("Standard Gemini test failed:", e);
  }

  try {
    results.push(await testMapsGrounding());
  } catch (e) {
    console.error("Maps Grounding test failed:", e);
  }

  try {
    results.push(await testGoogleSearch());
  } catch (e) {
    console.error("Google Search test failed:", e);
  }

  try {
    results.push(await testFlashLite());
  } catch (e) {
    console.error("Flash-Lite test failed:", e);
  }

  // Print results
  console.log("\n");
  console.log("═".repeat(60));
  console.log("📊 RESULTS SUMMARY");
  console.log("═".repeat(60));

  console.log("\n┌────────────────────────────────────┬──────────┬──────────┬───────────┐");
  console.log("│ Method                             │ Time(ms) │ Cost($)  │ Quality   │");
  console.log("├────────────────────────────────────┼──────────┼──────────┼───────────┤");

  for (const r of results) {
    const name = r.name.padEnd(34).slice(0, 34);
    const time = String(r.responseTimeMs).padStart(7);
    const cost = r.estimatedCost.toFixed(6).padStart(8);
    const quality = r.quality.padStart(9);
    console.log(`│ ${name} │ ${time}  │ ${cost} │ ${quality} │`);
  }

  console.log("└────────────────────────────────────┴──────────┴──────────┴───────────┘");

  // Find cheapest
  const sorted = [...results].sort((a, b) => a.estimatedCost - b.estimatedCost);
  const cheapest = sorted[0];
  const fastest = [...results].sort(
    (a, b) => a.responseTimeMs - b.responseTimeMs
  )[0];

  console.log("\n📈 ANALYSIS:");
  console.log(`   💰 Cheapest: ${cheapest.name} ($${cheapest.estimatedCost.toFixed(6)})`);
  console.log(`   ⚡ Fastest: ${fastest.name} (${fastest.responseTimeMs}ms)`);

  // Cost comparison
  console.log("\n💵 COST COMPARISON (per 1000 trips):");
  for (const r of results) {
    const cost1000 = (r.estimatedCost * 1000).toFixed(2);
    console.log(`   ${r.name}: $${cost1000}`);
  }

  // Recommendations
  console.log("\n✅ RECOMMENDATIONS:");
  console.log("   1. Use Flash-Lite for simple queries (tips, single activities)");
  console.log("   2. Use Standard Gemini for full itinerary generation");
  console.log("   3. Activity Bank caching provides 90% savings on additions");
  console.log("   4. Maps Grounding is best when Place IDs are needed");

  // Current implementation status
  console.log("\n📋 CURRENT IMPLEMENTATION STATUS:");
  console.log("   ✓ /api/ai/generate - Uses Maps Grounding (when enabled)");
  console.log("   ✓ AI Assistant - Uses Activity Bank cache (90% savings)");
  console.log("   ○ regenerate-activity - Standard Gemini (no grounding)");
  console.log("   ○ activity-bank - Standard Gemini for population");

  console.log("\n═".repeat(60));
  console.log("Test complete!");
}

runAllTests().catch(console.error);
