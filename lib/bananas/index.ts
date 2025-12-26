/**
 * Bananas Currency System
 *
 * Main exports for the banana reward system including:
 * - Balance operations
 * - Transaction management
 * - Tier progression
 * - Configuration
 */

// Configuration and constants
export * from './config';

// Balance operations
export {
  getBananaBalance,
  getAvailableBalance,
  hasEnoughBananas,
  getExpiringBananas,
} from './balance';

// Transaction operations
export {
  addBananas,
  spendBananas,
  getTransactionHistory,
  addReferralBananas,
  addCollaborationBananas,
  addTierBonus,
  clawbackBananas,
  getReferralBananasEarned,
} from './transactions';

// Tier operations
export {
  getReferralTierInfo,
  getTierBadges,
  checkAndUnlockTier,
  getTierBenefits,
  getUserReferralTier,
  getAIGenerationBonus,
  getAIRegenerationBonus,
  hasPrioritySupport,
  hasEarlyAccess,
  getTemplateAccess,
  initializeTierRecord,
} from './tiers';
