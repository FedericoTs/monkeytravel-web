import { createClient } from '@supabase/supabase-js'

// Fallbacks keep `next build` from throwing "supabaseUrl is required" when this
// module is evaluated in an env that lacks the Supabase vars (e.g. Vercel Preview
// builds). Real values are always present at runtime; placeholders are never queried.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co"
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key"

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
