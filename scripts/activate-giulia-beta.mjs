/**
 * Script to activate BETA2026 code for Giulia
 * Run with: node scripts/activate-giulia-beta.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function activateBeta() {
  const GIULIA_USER_ID = '94c67778-2acd-4b7b-8e6d-7ed8b0a23e3e';
  const CODE_ID = 'a30a248d-7219-4164-be76-549af1e52870';

  console.log('='.repeat(60));
  console.log('ACTIVATING BETA2026 FOR GIULIA');
  console.log('='.repeat(60));
  console.log();

  console.log('1. Checking existing access...');

  const { data: existing, error: checkError } = await supabase
    .from('user_tester_access')
    .select('*')
    .eq('user_id', GIULIA_USER_ID)
    .single();

  if (existing) {
    console.log('   User already has access!');
    console.log('   Code:', existing.code_used);
    console.log('   Expires:', existing.expires_at);
    console.log('   Generations used:', existing.ai_generations_used);
    return;
  }

  console.log('   No existing access found.');
  console.log();
  console.log('2. Creating access record...');

  const { data, error } = await supabase
    .from('user_tester_access')
    .insert({
      user_id: GIULIA_USER_ID,
      code_id: CODE_ID,
      code_used: 'BETA2026',
      ai_generations_limit: null,
      ai_generations_used: 0,
      ai_regenerations_limit: null,
      ai_regenerations_used: 0,
      ai_assistant_limit: null,
      ai_assistant_used: 0,
      expires_at: '2026-02-28T00:00:00+00:00'
    })
    .select()
    .single();

  if (error) {
    console.log('   Error:', error.message);
    console.log('   Code:', error.code);

    if (error.code === '42501') {
      console.log();
      console.log('   RLS is blocking direct insert.');
      console.log('   The user needs to redeem the code through the app.');
      console.log();
      console.log('   INSTRUCTIONS FOR GIULIA:');
      console.log('   1. Go to https://monkeytravel.app');
      console.log('   2. Log in with nava.giulia98@gmail.com');
      console.log('   3. Navigate to Profile/Settings');
      console.log('   4. Enter code: BETA2026');
      console.log('   5. Click "Redeem"');
    }
  } else {
    console.log('   SUCCESS! Access created:');
    console.log('   Code:', data.code_used);
    console.log('   Expires:', data.expires_at);
    console.log('   Limits: Unlimited');
  }

  console.log();
  console.log('='.repeat(60));
}

activateBeta();
