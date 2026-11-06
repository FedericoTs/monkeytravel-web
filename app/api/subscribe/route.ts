import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { errors, apiSuccess } from '@/lib/api/response-wrapper'
import { isValidEmail, normalizeEmail } from '@/lib/validation'
import { createRateLimiter } from '@/lib/api/rate-limit'

import { readJsonBody } from "@/lib/api/json-body";

// 5 subscriptions per IP per hour
const limiter = createRateLimiter("subscribe", 5, 60 * 60 * 1000);
const MAX_EMAIL_CHARS = 254;
const MAX_SOURCE_CHARS = 50;
// The same whether the address is new or already on the list, so nobody can use
// this to test who's on it.
const JOINED = { message: 'Successfully joined the waitlist!' };

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const { allowed } = await limiter.check(request);
    if (!allowed) {
      return errors.rateLimit("Too many subscription attempts. Please try again later.");
    }

    // A malformed body is a 400, not an unwrapped request.json() crash.
    const { body, invalidBody } = await readJsonBody<{ email?: string; source?: string }>(request);
    if (invalidBody) return invalidBody;
    const { email, source = 'website' } = body

    // Validate email
    if (!email || typeof email !== 'string') {
      return errors.badRequest('Email is required')
    }

    // Use shared email validation
    if (email.length > MAX_EMAIL_CHARS || !isValidEmail(email)) {
      return errors.badRequest('Invalid email format')
    }
    if (typeof source !== 'string' || source.length > MAX_SOURCE_CHARS) {
      return errors.badRequest('Invalid source')
    }

    // Get metadata from request
    const metadata = {
      userAgent: request.headers.get('user-agent') || undefined,
      referer: request.headers.get('referer') || undefined,
      timestamp: new Date().toISOString(),
    }

    // Insert through the service role. A read-back on the anon client would
    // need a SELECT policy letting the public anon key list every subscriber's
    // email; 20260924123000 removes that policy.
    const { error } = await createAdminClient()
      .from('email_subscribers')
      .insert({
        email: normalizeEmail(email),
        source,
        metadata,
      })

    // A duplicate means the address is on the list, which is what was asked for.
    if (error && error.code !== '23505') {
      console.error('[Subscribe] Supabase error:', error)
      return errors.internal('Failed to subscribe. Please try again.', 'Subscribe')
    }

    return apiSuccess(JOINED, { status: 201 })
  } catch (error) {
    console.error('[Subscribe] Error:', error)
    return errors.internal('An unexpected error occurred', 'Subscribe')
  }
}
