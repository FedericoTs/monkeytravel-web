// Trial system utilities
// Users get a 7-day trial period with full AI features

export const TRIAL_DAYS = 7;

/**
 * Calculate trial end date from now
 */
export function getTrialEndDate(): Date {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + TRIAL_DAYS);
  return endDate;
}

/**
 * Check if a trial is still active
 */
export function isTrialActive(trialEndsAt: string | Date | null): boolean {
  if (!trialEndsAt) return false;
  const endDate = new Date(trialEndsAt);
  return endDate > new Date();
}

/**
 * Get days remaining in trial
 */
export function getTrialDaysRemaining(trialEndsAt: string | Date | null): number {
  if (!trialEndsAt) return 0;
  const endDate = new Date(trialEndsAt);
  const now = new Date();
  const diff = endDate.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Check user's access level
 */
export type AccessLevel = "pro" | "trial" | "free";

export function getUserAccessLevel(
  isPro: boolean,
  trialEndsAt: string | Date | null
): AccessLevel {
  if (isPro) return "pro";
  if (isTrialActive(trialEndsAt)) return "trial";
  return "free";
}

/**
 * Check if user has full AI access (Pro or active trial)
 */
export function hasFullAccess(
  isPro: boolean,
  trialEndsAt: string | Date | null
): boolean {
  const level = getUserAccessLevel(isPro, trialEndsAt);
  return level === "pro" || level === "trial";
}
