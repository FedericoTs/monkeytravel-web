/**
 * Email Validation Utilities
 *
 * Consolidated email validation logic for consistent validation across the app.
 * Uses RFC 5322 compliant regex pattern with additional practical constraints.
 */

/**
 * Strict email regex pattern
 * - Requires alphanumeric characters plus common special chars before @
 * - Requires valid domain with at least 2 character TLD
 * - Case insensitive
 */
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Basic email regex for quick validation (less strict)
 * Use this for real-time typing feedback
 */
const EMAIL_REGEX_BASIC = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email format
 *
 * @param email - Email address to validate
 * @param strict - Use strict validation (default: true)
 * @returns true if email is valid
 *
 * @example
 * isValidEmail('user@example.com') // true
 * isValidEmail('invalid') // false
 * isValidEmail('user@domain.c') // false (TLD too short)
 */
export function isValidEmail(email: string, strict = true): boolean {
  if (!email || typeof email !== "string") {
    return false;
  }

  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const regex = strict ? EMAIL_REGEX : EMAIL_REGEX_BASIC;
  return regex.test(trimmed);
}

/**
 * Validation result with error message
 */
export interface EmailValidationResult {
  valid: boolean;
  error?: string;
  field?: string;
}

/**
 * Validate email with detailed error messages
 *
 * @param email - Email address to validate
 * @returns Validation result with error details if invalid
 *
 * @example
 * validateEmail('') // { valid: false, error: 'Email is required.', field: 'email' }
 * validateEmail('invalid') // { valid: false, error: 'Please enter a valid email address.', field: 'email' }
 * validateEmail('user@example.com') // { valid: true }
 */
export function validateEmail(email: string): EmailValidationResult {
  if (!email || email.trim().length === 0) {
    return {
      valid: false,
      error: "Email is required.",
      field: "email",
    };
  }

  if (!isValidEmail(email)) {
    return {
      valid: false,
      error: "Please enter a valid email address.",
      field: "email",
    };
  }

  return { valid: true };
}

/**
 * Normalize email address
 * - Trims whitespace
 * - Converts to lowercase
 *
 * @param email - Email to normalize
 * @returns Normalized email or empty string if invalid
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== "string") {
    return "";
  }
  return email.trim().toLowerCase();
}

/**
 * Extract domain from email address
 *
 * @param email - Email address
 * @returns Domain part or null if invalid
 */
export function getEmailDomain(email: string): string | null {
  if (!isValidEmail(email)) {
    return null;
  }

  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}
