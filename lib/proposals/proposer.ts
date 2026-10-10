import type { ActivityProposal } from "@/types";
import type { UserProfile } from "@/lib/api/batch-users";
import { publicNameOrNull } from "@/lib/profile/public-name";

/**
 * A proposal's proposer as the proposal routes return it, from public_profiles
 * (public.users shows a caller only their own row, so everyone else read
 * "Unknown"). No public name: undefined, which the cards show as "Unknown".
 */
export function publicProposer(
  profile: UserProfile | undefined,
  email?: string | null
): ActivityProposal["proposer"] {
  const name = publicNameOrNull(profile?.display_name, email);
  return name ? { display_name: name, avatar_url: profile?.avatar_url || undefined } : undefined;
}
