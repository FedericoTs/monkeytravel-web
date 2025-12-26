import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { errors, apiSuccess } from '@/lib/api/response-wrapper'
import { isValidEmail, normalizeEmail } from '@/lib/validation'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
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
