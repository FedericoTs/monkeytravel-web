# MonkeyTravel MCP Server - MVP Plan

**Version**: MVP 1.0
**Target**: 2 weeks to ChatGPT Developer Mode
**Focus**: Ship fast, iterate later

---

## What We're Building

A single MCP endpoint that lets ChatGPT users generate travel itineraries using our existing AI infrastructure.

```
ChatGPT User → "Plan 5 days in Rome" → MCP Server → Gemini 2.5 → Itinerary Widget
```

---

## MVP Scope

### In Scope (Week 1-2)
- [x] One tool: `generate_trip`
- [x] Basic HTML widget to display itinerary
- [x] CTA link to MonkeyTravel app
- [x] Simple rate limiting (Vercel built-in)
- [x] Basic error handling

### Out of Scope (Future)
- ~~OAuth 2.1 validation~~ → Use API key for now
- ~~Multiple tools~~ → Just generate_trip
- ~~Interactive widgets~~ → Static HTML
- ~~User accounts~~ → Anonymous trips
- ~~Monitoring dashboards~~ → Console logs

---

## File Structure (Minimal)

```
app/api/mcp/
├── route.ts              # MCP endpoint (~150 lines)
└── widget.ts             # HTML generator (~100 lines)

lib/mcp/
├── schema.ts             # Zod validation (~50 lines)
└── generate.ts           # Trip generation (~100 lines)
```

**Total: ~400 lines of new code**

---

## Implementation

### 1. MCP Endpoint

```typescript
// app/api/mcp/route.ts

import { NextRequest, NextResponse } from "next/server";
import { generateTrip } from "@/lib/mcp/generate";
import { GenerateTripSchema } from "@/lib/mcp/schema";
import { generateWidget } from "./widget";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Simple API key check (replace with OAuth later)
    const apiKey = request.headers.get("X-API-Key");
    if (apiKey !== process.env.MCP_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Handle MCP protocol
    if (body.method === "tools/list") {
      return NextResponse.json({
        tools: [{
          name: "generate_trip",
          description: "Create a day-by-day travel itinerary with activities and restaurants",
          inputSchema: {
            type: "object",
            properties: {
              destination: { type: "string", description: "City or region to visit" },
              days: { type: "number", description: "Number of days (1-14)" },
              travel_style: {
                type: "string",
                enum: ["adventure", "relaxation", "cultural", "foodie", "budget", "luxury"],
                description: "Optional travel style preference"
              }
            },
            required: ["destination", "days"]
          }
        }]
      });
    }

    if (body.method === "tools/call" && body.params?.name === "generate_trip") {
      // Validate input
      const input = GenerateTripSchema.parse(body.params.arguments);

      // Generate trip using existing Gemini infrastructure
      const trip = await generateTrip(input);

      // Return widget
      return NextResponse.json({
        content: [
          { type: "text", text: trip.summary },
          {
            type: "resource",
            resource: {
              uri: `widget://itinerary/${trip.id}`,
              mimeType: "text/html",
              text: generateWidget(trip)
            }
          }
        ]
      });
    }

    return NextResponse.json({ error: "Unknown method" }, { status: 400 });

  } catch (error) {
    console.error("[MCP Error]", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Internal error"
    }, { status: 500 });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: "1.0.0",
    tools: ["generate_trip"]
  });
}
```

### 2. Input Schema

```typescript
// lib/mcp/schema.ts

import { z } from "zod";

export const GenerateTripSchema = z.object({
  destination: z.string().min(2).max(100),
  days: z.number().int().min(1).max(14),
  travel_style: z.enum([
    "adventure", "relaxation", "cultural", "foodie", "budget", "luxury"
  ]).optional(),
});

export type GenerateTripInput = z.infer<typeof GenerateTripSchema>;
```

### 3. Trip Generation (Reuse Existing)

```typescript
// lib/mcp/generate.ts

import { GenerateTripInput } from "./schema";
import { generateWithGemini } from "@/lib/ai/gemini";

export async function generateTrip(input: GenerateTripInput) {
  const prompt = `Create a ${input.days}-day travel itinerary for ${input.destination}.
${input.travel_style ? `Travel style: ${input.travel_style}.` : ""}

For each day provide:
- Theme for the day
- 4-5 activities with times (e.g., "09:00-11:00")
- Restaurant recommendations
- Local tips

Return JSON: { "days": [{ "day": 1, "theme": "...", "activities": [...] }] }`;

  const response = await generateWithGemini({
    model: "gemini-2.5-pro-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  });

  const itinerary = JSON.parse(response.text);

  return {
    id: crypto.randomUUID(),
    destination: input.destination,
    days: input.days,
    itinerary: itinerary.days,
    summary: `Your ${input.days}-day ${input.destination} itinerary is ready!`,
    saveUrl: `https://monkeytravel.app/trip/new?destination=${encodeURIComponent(input.destination)}&days=${input.days}&source=chatgpt`
  };
}
```

### 4. Simple Widget

```typescript
// app/api/mcp/widget.ts

export function generateWidget(trip: {
  destination: string;
  days: number;
  itinerary: Array<{ day: number; theme: string; activities: Array<{ name: string; time: string; description: string }> }>;
  saveUrl: string;
}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; padding: 16px; }
    .header { background: #0A4B73; color: white; padding: 16px; border-radius: 8px; margin-bottom: 16px; }
    .header h1 { font-size: 18px; }
    .day { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .day-header { font-weight: 600; color: #0A4B73; margin-bottom: 12px; }
    .activity { padding: 8px 0; border-bottom: 1px solid #eee; }
    .activity:last-child { border: none; }
    .time { font-size: 12px; color: #666; }
    .name { font-weight: 500; margin: 4px 0; }
    .desc { font-size: 13px; color: #444; }
    .cta { display: block; background: #0A4B73; color: white; text-align: center;
           padding: 14px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${trip.days} Days in ${escapeHtml(trip.destination)}</h1>
  </div>

  ${trip.itinerary.map(day => `
    <div class="day">
      <div class="day-header">Day ${day.day}: ${escapeHtml(day.theme)}</div>
      ${day.activities.map(act => `
        <div class="activity">
          <div class="time">${escapeHtml(act.time)}</div>
          <div class="name">${escapeHtml(act.name)}</div>
          <div class="desc">${escapeHtml(act.description)}</div>
        </div>
      `).join('')}
    </div>
  `).join('')}

  <a href="${trip.saveUrl}" class="cta" target="_blank">
    Save to MonkeyTravel
  </a>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] || c));
}
```

---

## Environment Variables

Add to `.env.local`:

```bash
# MCP Server
MCP_API_KEY=your-random-api-key-here
```

---

## Testing

```bash
# Test health endpoint
curl http://localhost:3000/api/mcp

# Test tool listing
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"method": "tools/list"}'

# Test trip generation
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "generate_trip",
      "arguments": { "destination": "Rome", "days": 3 }
    }
  }'
```

---

## Deployment

1. Add `MCP_API_KEY` to Vercel environment variables
2. Deploy: `npx vercel --prod`
3. Test endpoint: `https://monkeytravel.app/api/mcp`

---

## ChatGPT Developer Mode Setup

1. Go to ChatGPT Settings → Developer Mode
2. Add new MCP Server:
   - **Name**: MonkeyTravel
   - **URL**: `https://monkeytravel.app/api/mcp`
   - **API Key**: Your MCP_API_KEY
3. Test: "Plan a 3-day trip to Barcelona"

---

## Success Metrics (MVP)

| Metric | Target |
|--------|--------|
| Works in ChatGPT Dev Mode | Yes |
| Generates valid itinerary | Yes |
| Widget displays correctly | Yes |
| CTA link works | Yes |
| Response time | < 10s |

---

## Future Improvements (Post-MVP)

1. **Week 3-4**: Add `modify_itinerary` tool
2. **Week 5-6**: OAuth 2.1 authentication
3. **Week 7-8**: Interactive widgets with day tabs
4. **Week 9+**: App submission, monitoring, scaling

---

## Estimated Effort

| Task | Hours |
|------|-------|
| MCP endpoint | 4h |
| Schema + validation | 1h |
| Trip generation (reuse existing) | 2h |
| Widget HTML | 2h |
| Testing | 2h |
| Deploy + ChatGPT setup | 1h |
| **Total** | **12h** |

---

*Ship it, learn from users, iterate.*
