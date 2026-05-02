import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isValidEmail, normalizeEmail } from "@/lib/validation";
import { createRateLimiter } from "@/lib/api/rate-limit";

const limiter = createRateLimiter("contact", 5, 60 * 60 * 1000);
const ALLOWED_TOPICS = new Set(["support", "partnership", "press", "feedback", "other"]);

export async function POST(request: NextRequest) {
  try {
    const { allowed } = limiter.check(request);
    if (!allowed) {
      return errors.rateLimit("Too many contact submissions. Please try again later.");
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return errors.badRequest("Invalid request body");
    }

    const { name, email, topic, message, locale } = body as Record<string, unknown>;

    if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
      return errors.badRequest("Invalid name");
    }
    if (typeof email !== "string" || !isValidEmail(email)) {
      return errors.badRequest("Invalid email");
    }
    if (typeof topic !== "string" || !ALLOWED_TOPICS.has(topic)) {
      return errors.badRequest("Invalid topic");
    }
    if (typeof message !== "string" || message.trim().length < 10 || message.length > 5000) {
      return errors.badRequest("Invalid message");
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "";
    const ipHash = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 32) : null;

    const { data, error } = await supabase
      .from("contact_messages")
      .insert({
        name: name.trim().slice(0, 200),
        email: normalizeEmail(email),
        topic,
        message: message.trim().slice(0, 5000),
        locale: typeof locale === "string" ? locale.slice(0, 8) : null,
        user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
        referer: request.headers.get("referer")?.slice(0, 500) ?? null,
        ip_hash: ipHash,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Contact] Supabase error:", error);
      return errors.internal("Failed to send message. Please try again.", "Contact");
    }

    return apiSuccess({ id: data.id }, { status: 201 });
  } catch (error) {
    console.error("[Contact] Error:", error);
    return errors.internal("An unexpected error occurred", "Contact");
  }
}
