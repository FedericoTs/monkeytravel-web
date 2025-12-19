/**
 * Test script for Maps Grounding API
 *
 * Run with: npx tsx scripts/test-maps-grounding.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

interface GroundingChunk {
  maps?: {
    placeId?: string;
    title?: string;
    uri?: string;
  };
}

interface GroundingMetadata {
  searchEntryPoint?: {
    renderedContent?: string;
  };
  groundingChunks?: GroundingChunk[];
  webSearchQueries?: string[];
  groundingSupports?: Array<{
    segment?: { text: string };
    groundingChunkIndices?: number[];
    confidenceScores?: number[];
  }>;
}

interface CandidatePart {
  text?: string;
}

interface Candidate {
  content?: {
    parts?: CandidatePart[];
    role?: string;
  };
  finishReason?: string;
  groundingMetadata?: GroundingMetadata;
}

interface ApiResponse {
  candidates?: Candidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

async function testMapsGrounding() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    console.error('❌ GOOGLE_AI_API_KEY not found in environment');
    process.exit(1);
  }

  console.log('🗺️  Testing Maps Grounding API...\n');
  console.log('API Key:', apiKey.substring(0, 10) + '...');

  // Test with a simple destination query
  const testPrompt = `You are a travel expert. Generate a 1-day itinerary for Tokyo, Japan.

For each activity, include:
- Name of the place
- Type (attraction, restaurant, cultural, etc.)
- Brief description
- Estimated time to spend
- Approximate cost

Focus on tourist-friendly places that are popular and well-known.`;

  // Tokyo coordinates for proximity grounding
  const tokyoCoords = { lat: 35.6762, lng: 139.6503 };

  const requestBody = {
    contents: [{
      role: "user",
      parts: [{
        text: testPrompt
      }]
    }],
    tools: [{
      googleMaps: {}  // Use Maps Grounding tool
    }],
    toolConfig: {
      retrievalConfig: {
        latLng: {
          latitude: tokyoCoords.lat,
          longitude: tokyoCoords.lng
        }
      }
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    }
  };

  console.log('\n📤 Sending request to Maps Grounding API...\n');

  const startTime = Date.now();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error (${response.status}):`, errorText);
      process.exit(1);
    }

    const data: ApiResponse = await response.json();

    console.log('✅ Response received in', elapsed, 'ms\n');

    // Check for error in response
    if (data.error) {
      console.error('❌ API returned error:', data.error);
      process.exit(1);
    }

    // Extract text response
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (textContent) {
      console.log('📝 Generated Itinerary (first 1000 chars):');
      console.log('─'.repeat(50));
      console.log(textContent.substring(0, 1000) + (textContent.length > 1000 ? '...' : ''));
      console.log('─'.repeat(50));
    }

    // Check for grounding metadata
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata;
    if (groundingMetadata) {
      console.log('\n🎯 Grounding Metadata Found!');

      const chunks = groundingMetadata.groundingChunks || [];
      const mapsChunks = chunks.filter(c => c.maps);

      console.log(`   - Total chunks: ${chunks.length}`);
      console.log(`   - Maps chunks: ${mapsChunks.length}`);

      if (mapsChunks.length > 0) {
        console.log('\n📍 Grounded Places:');
        mapsChunks.slice(0, 5).forEach((chunk, i) => {
          console.log(`   ${i + 1}. ${chunk.maps?.title || 'Unknown'}`);
          console.log(`      Place ID: ${chunk.maps?.placeId || 'N/A'}`);
          console.log(`      URI: ${chunk.maps?.uri || 'N/A'}`);
        });
        if (mapsChunks.length > 5) {
          console.log(`   ... and ${mapsChunks.length - 5} more places`);
        }
      }

      if (groundingMetadata.webSearchQueries?.length) {
        console.log('\n🔍 Search Queries Used:');
        groundingMetadata.webSearchQueries.forEach((q, i) => {
          console.log(`   ${i + 1}. ${q}`);
        });
      }
    } else {
      console.log('\n⚠️ No grounding metadata in response');
      console.log('   This might indicate the google_search tool is not being used');
    }

    // Token usage
    if (data.usageMetadata) {
      console.log('\n📊 Token Usage:');
      console.log(`   - Prompt tokens: ${data.usageMetadata.promptTokenCount}`);
      console.log(`   - Response tokens: ${data.usageMetadata.candidatesTokenCount}`);
      console.log(`   - Total tokens: ${data.usageMetadata.totalTokenCount}`);

      // Estimate cost (Gemini 2.5 Flash pricing)
      const inputCost = ((data.usageMetadata.promptTokenCount || 0) / 1_000_000) * 0.075;
      const outputCost = ((data.usageMetadata.candidatesTokenCount || 0) / 1_000_000) * 0.30;
      const totalCost = inputCost + outputCost;
      console.log(`   - Estimated cost: $${totalCost.toFixed(6)}`);
    }

    console.log('\n✅ Maps Grounding test completed successfully!');

  } catch (error) {
    console.error('❌ Request failed:', error);
    process.exit(1);
  }
}

testMapsGrounding();
