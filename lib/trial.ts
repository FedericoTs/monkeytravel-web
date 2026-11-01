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

