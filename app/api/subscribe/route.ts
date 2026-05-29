import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { errors, apiSuccess } from '@/lib/api/response-wrapper'
import { isValidEmail, normalizeEmail } from '@/lib/validation'
import { createRateLimiter } from '@/lib/api/rate-limit'

// 5 subscriptions per IP per hour
const limiter = createRateLimiter("subscribe", 5, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const { allowed } = await limiter.check(request);
    if (!allowed) {
      return errors.rateLimit("Too many subscription attempts. Please try again later.");
    }

    // Bug-bounty 2026-05-24 P1: unwrapped request.json() crashes on
    // malformed body — should 400 not 500.
    let body: { email?: string; source?: string };
    try {
      body = (await request.json()) as { email?: string; source?: string };
    } catch {
      return errors.badRequest('Body must be valid JSON');
    }
    const { email, source = 'website' } = body

    // Validate email
    if (!email || typeof email !== 'string') {
      return errors.badRequest('Email is required')
    }

    // Use shared email validation
    if (!isValidEmail(email)) {
      return errors.badRequest('Invalid email format')
    }

    // Get metadata from request
    const metadata = {
      userAgent: request.headers.get('user-agent') || undefined,
      referer: request.headers.get('referer') || undefined,
      timestamp: new Date().toISOString(),
    }

    // Insert into Supabase
    const { data, error } = await supabase
      .from('email_subscribers')
      .insert({
        email: normalizeEmail(email),
        source,
        metadata,
      })
      .select('id, email')
      .single()

    if (error) {
      // Handle duplicate email - not an error, just inform user
      if (error.code === '23505') {
        return apiSuccess({ message: 'You are already on our waitlist!' })
      }

      console.error('[Subscribe] Supabase error:', error)
      return errors.internal('Failed to subscribe. Please try again.', 'Subscribe')
    }

    return apiSuccess(
      { message: 'Successfully joined the waitlist!', id: data.id },
      { status: 201 }
    )
  } catch (error) {
    console.error('[Subscribe] Error:', error)
    return errors.internal('An unexpected error occurred', 'Subscribe')
  }
}
