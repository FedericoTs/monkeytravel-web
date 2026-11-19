import { geolocation } from "@vercel/functions";

/**
 * The country a visitor is in, as the network sees it ("IN"), or null: where a
 * browser's language says little about it (English set to the United States or
 * Britain), the planner shows prices in that country's currency
 * (lib/locale/context.tsx). Nothing is kept, and the answer is the visitor's own.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const country = geolocation(request).country;
  return Response.json(
    { country: typeof country === "string" && /^[A-Z]{2}$/.test(country) ? country : null },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
