export interface RecoveryHealth {
  recoveries: number;
  recovery_users: number;
  password_changes: number;
}

/**
 * The signature of a silently broken password reset: people keep asking for
 * one and nobody's password ever changes. A few requests with no change is
 * normal (people give up, or sign in another way), so a floor applies.
 */
export function recoveryLooksBroken(health: RecoveryHealth, minRecoveries = 5): boolean {
  return health.recoveries >= minRecoveries && health.password_changes === 0;
}
