/**
 * Whether the referral program's ways in show: the top bar's Share, the banner on
 * My trips and the profile's Referrals & Rewards section. Off unless
 * NEXT_PUBLIC_REFERRALS_ENABLED is "true". Links already shared (/join/<code>, and
 * ?ref on share links) keep working either way.
 */
export function referralsShown(): boolean {
  return process.env.NEXT_PUBLIC_REFERRALS_ENABLED === "true";
}
