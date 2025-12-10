/**
 * Auth Error Humanization Utility
 *
 * Converts cryptic Supabase auth error messages into user-friendly messages
 * with clear guidance on how to resolve the issue.
 */

export interface AuthError {
  message: string;
  field?: 'email' | 'password' | 'general';
  suggestion?: string;
}

// Map of Supabase error messages to user-friendly messages
const ERROR_MAP: Record<string, AuthError> = {
  // Login errors
  'Invalid login credentials': {
    message: 'The email or password you entered is incorrect.',
    field: 'general',
    suggestion: 'Please check your credentials and try again.',
  },
  'invalid_credentials': {
    message: 'The email or password you entered is incorrect.',
    field: 'general',
    suggestion: 'Please check your credentials and try again.',
  },
  'Email not confirmed': {
    message: 'Your email address has not been verified yet.',
    field: 'email',
    suggestion: 'Please check your inbox for the confirmation email.',
  },
  'email_not_confirmed': {
    message: 'Your email address has not been verified yet.',
    field: 'email',
    suggestion: 'Please check your inbox for the confirmation email.',
  },

  // Signup errors
  'User already registered': {
    message: 'An account with this email already exists.',
    field: 'email',
    suggestion: 'Try signing in instead, or use a different email.',
  },
  'user_already_exists': {
    message: 'An account with this email already exists.',
    field: 'email',
    suggestion: 'Try signing in instead, or use a different email.',
  },
  'A user with this email address has already been registered': {
    message: 'An account with this email already exists.',
    field: 'email',
    suggestion: 'Try signing in instead, or use a different email.',
  },

  // Password errors
  'Password should be at least 6 characters': {
    message: 'Your password is too short.',
    field: 'password',
    suggestion: 'Please use at least 6 characters.',
  },
  'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789': {
    message: 'Your password needs to be stronger.',
    field: 'password',
    suggestion: 'Include at least one lowercase letter, one uppercase letter, and one number.',
  },

  // Email errors
  'Unable to validate email address: invalid format': {
    message: 'Please enter a valid email address.',
    field: 'email',
    suggestion: 'Check that your email is formatted correctly (e.g., you@example.com).',
  },
  'invalid_email': {
    message: 'Please enter a valid email address.',
    field: 'email',
    suggestion: 'Check that your email is formatted correctly.',
  },

  // Rate limiting
  'For security purposes, you can only request this after': {
    message: 'Too many attempts. Please wait a moment.',
    field: 'general',
    suggestion: 'For your security, please wait a minute before trying again.',
  },
  'Email rate limit exceeded': {
    message: 'Too many email requests.',
    field: 'general',
    suggestion: 'Please wait a few minutes before requesting another email.',
  },

  // Network/server errors
  'Failed to fetch': {
    message: 'Unable to connect to the server.',
    field: 'general',
    suggestion: 'Please check your internet connection and try again.',
  },
  'NetworkError': {
    message: 'Network connection error.',
    field: 'general',
    suggestion: 'Please check your internet connection and try again.',
  },

  // OAuth errors
  'OAuth error': {
    message: 'Sign in with Google failed.',
    field: 'general',
    suggestion: 'Please try again or use email sign in.',
  },
};

/**
 * Convert a Supabase auth error message to a user-friendly message
 */
export function humanizeAuthError(errorMessage: string): AuthError {
  // Check for exact match
  if (ERROR_MAP[errorMessage]) {
    return ERROR_MAP[errorMessage];
  }

  // Check for partial matches (some error messages contain dynamic content)
  for (const [key, value] of Object.entries(ERROR_MAP)) {
    if (errorMessage.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  // Check for rate limiting pattern (contains time)
  if (errorMessage.includes('you can only request this after')) {
    return {
      message: 'Too many attempts. Please wait a moment.',
      field: 'general',
      suggestion: 'For your security, please wait before trying again.',
    };
  }

  // Default fallback for unknown errors
  return {
    message: 'Something went wrong. Please try again.',
    field: 'general',
    suggestion: 'If the problem persists, please contact support.',
  };
}

/**
 * Validate email format client-side
 */
export function validateEmail(email: string): AuthError | null {
  if (!email) {
    return {
      message: 'Email is required.',
      field: 'email',
    };
  }

  // Basic email regex pattern
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      message: 'Please enter a valid email address.',
      field: 'email',
      suggestion: 'Check that your email is formatted correctly (e.g., you@example.com).',
    };
  }

  return null;
}

/**
 * Validate password requirements
 */
export function validatePassword(password: string): AuthError | null {
  if (!password) {
    return {
      message: 'Password is required.',
      field: 'password',
    };
  }

  if (password.length < 6) {
    return {
      message: 'Password must be at least 6 characters.',
      field: 'password',
      suggestion: 'Please choose a longer password for better security.',
    };
  }

  return null;
}

/**
 * Validate all login fields
 */
export function validateLoginForm(email: string, password: string): AuthError | null {
  const emailError = validateEmail(email);
  if (emailError) return emailError;

  const passwordError = validatePassword(password);
  if (passwordError) return passwordError;

  return null;
}

/**
 * Validate all signup fields
 */
export function validateSignupForm(
  email: string,
  password: string,
  displayName?: string
): AuthError | null {
  // Display name is optional but has a max length if provided
  if (displayName && displayName.length > 50) {
    return {
      message: 'Display name is too long.',
      field: 'general',
      suggestion: 'Please use 50 characters or fewer.',
    };
  }

  const emailError = validateEmail(email);
  if (emailError) return emailError;

  const passwordError = validatePassword(password);
  if (passwordError) return passwordError;

  return null;
}
