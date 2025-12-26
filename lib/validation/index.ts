/**
 * Validation Module
 *
 * Centralized validation utilities for consistent validation across the app.
 *
 * @example
 * import { isValidEmail, validateEmail, normalizeEmail } from '@/lib/validation';
 */

export {
  isValidEmail,
  validateEmail,
  normalizeEmail,
  getEmailDomain,
  type EmailValidationResult,
} from "./email";
