/**
 * Amadeus API Client
 *
 * Singleton pattern for client reuse with automatic token refresh.
 * Uses the official Amadeus Node.js SDK.
 *
 * @see https://github.com/amadeus4dev/amadeus-node
 */

import Amadeus from 'amadeus';

// Environment validation
const AMADEUS_CLIENT_ID = process.env.AMADEUS_CLIENT_ID;
const AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET;
const AMADEUS_HOSTNAME = (process.env.AMADEUS_HOSTNAME as 'test' | 'production') || 'test';

// Singleton instance
let amadeusClient: Amadeus | null = null;

/**
 * Configuration validation
 */
function validateConfig(): void {
  if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
    throw new Error(
      'Amadeus credentials not configured. Please set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET environment variables.'
    );
  }
}

/**
 * Get the Amadeus client singleton instance.
 * Creates a new client if one doesn't exist.
 *
 * The SDK handles OAuth2 token management automatically:
 * - Initial token fetch on first request
 * - Automatic refresh when token expires (~30 min lifetime)
 *
 * @returns Amadeus client instance
 * @throws Error if credentials are not configured
 */
export function getAmadeusClient(): Amadeus {
  if (!amadeusClient) {
    validateConfig();

    amadeusClient = new Amadeus({
      clientId: AMADEUS_CLIENT_ID!,
      clientSecret: AMADEUS_CLIENT_SECRET!,
      hostname: AMADEUS_HOSTNAME,
      // Log level: 'debug' for development, 'silent' for production
      logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'silent',
    });

    console.log(`[Amadeus] Client initialized in ${AMADEUS_HOSTNAME} mode`);
  }

  return amadeusClient;
}

/**
 * Check if Amadeus client is configured and ready
 */
export function isAmadeusConfigured(): boolean {
  return !!(AMADEUS_CLIENT_ID && AMADEUS_CLIENT_SECRET);
}

/**
 * Get the current environment (test or production)
 */
export function getAmadeusEnvironment(): 'test' | 'production' {
  return AMADEUS_HOSTNAME;
}

/**
 * Reset the client (useful for testing or when credentials change)
 */
export function resetAmadeusClient(): void {
  amadeusClient = null;
}

/**
 * Wrapper for handling Amadeus API errors consistently
 */
export async function withAmadeusErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Type assertion for Amadeus error response
    const amadeusError = error as {
      response?: {
        statusCode?: number;
        body?: string;
        result?: {
          errors?: Array<{
            status: number;
            code: number;
            title: string;
            detail: string;
          }>;
        };
      };
      code?: string;
    };

    // Parse error details
    const statusCode = amadeusError.response?.statusCode || 500;
    const errors = amadeusError.response?.result?.errors || [];
    const firstError = errors[0];

    // Log error for debugging
    console.error(`[Amadeus] ${context} error:`, {
      statusCode,
      errors,
      code: amadeusError.code,
    });

    // Handle specific error types
    if (statusCode === 401) {
      // Token expired or invalid - reset client to force new auth
      resetAmadeusClient();
      throw new Error('Amadeus authentication failed. Please check credentials.');
    }

    if (statusCode === 429) {
      throw new Error('Amadeus rate limit exceeded. Please try again in a moment.');
    }

    if (statusCode === 400 && firstError) {
      throw new Error(`Amadeus request error: ${firstError.detail || firstError.title}`);
    }

    // Generic error
    throw new Error(
      firstError?.detail ||
        firstError?.title ||
        `Amadeus API error in ${context}: ${statusCode}`
    );
  }
}

/**
 * Test the Amadeus connection by making a simple API call
 * Useful for health checks and validating credentials
 */
export async function testAmadeusConnection(): Promise<{
  success: boolean;
  environment: string;
  message: string;
}> {
  try {
    const amadeus = getAmadeusClient();

    // Make a simple location search as a connection test
    await amadeus.referenceData.locations.get({
      keyword: 'NYC',
      subType: 'CITY',
      'page[limit]': 1,
    });

    return {
      success: true,
      environment: AMADEUS_HOSTNAME,
      message: 'Amadeus connection successful',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      environment: AMADEUS_HOSTNAME,
      message: `Amadeus connection failed: ${message}`,
    };
  }
}
