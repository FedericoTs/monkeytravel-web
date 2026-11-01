import { createAdminClient } from "@/lib/supabase/admin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

/**
 * Build a shared-trip URL that carries the OWNER's referral code as ?ref, so
 * every shared link is a credited acquisition surface (the dominant organic
 * channel). Falls back to a plain link if the code can't be resolved — sharing
 * must never fail just because referral attribution couldn't be stamped.
 */
export async function buildShareUrl(ownerId: string, token: string): Promise<string> {
  let ref = "";
  try {
    const { data: code, error } = await createAdminClient().rpc("get_or_create_referral_code", {
      p_user_id: ownerId,
    });
    if (error) throw error;
    if (code && typeof code === "string") ref = `?ref=${encodeURIComponent(code)}`;
  } catch (e) {
    console.error("[Share] referral-code resolve failed (link still valid):", e);
  }
  return `${APP_URL}/shared/${token}${ref}`;
}
