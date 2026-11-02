import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/**
 * Vercel Cron calls a cron route with `Authorization: Bearer ${CRON_SECRET}`,
 * and so does a manual run (curl -H "Authorization: Bearer $CRON_SECRET").
 * Returns the 401 to send for any other request, or null for the cron.
 * Without a CRON_SECRET every request is refused: an unset env must never
 * leave a cron open.
 */
export function refuseUnlessCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameText(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** String equality in constant time for equal lengths. */
function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
