-- Stop naming people after their email address.
--
-- WHAT WAS WRONG
-- --------------
-- handle_new_user() seeded display_name as:
--
--     COALESCE(raw_user_meta_data->>'display_name', SPLIT_PART(email,'@',1))
--
-- It never looked at `full_name` or `name` -- which is exactly what Google
-- OAuth puts in raw_user_meta_data. So every Google signup fell through to the
-- email local-part.
--
-- MEASURED 2026-09-01 (505 users):
--     432  display_name equals the email local-part
--     357  of those are @gmail.com  -> display_name || '@gmail.com' IS the
--          address, and public_profiles is readable by ANON for all 505 rows,
--          so an unauthenticated scraper walks away with a validated list
--     324  Google users, and ALL 324 have a usable full_name claim
--     317  Google users displayed as their email prefix despite that
--
-- Two separate harms. Privacy: a real name is not a credential, an email
-- address is, and this made ~357 of them derivable with one guess. Product:
-- lib/notifications/service.ts puts display_name in every outbound email
-- greeting, and the invite page renders "john.smith1987 invited you".
--
-- WHY THE TRIGGER AND NOT THE AUTH CALLBACK
-- -----------------------------------------
-- app/auth/callback/route.ts has a block that derives exactly this name from
-- full_name -- and it has never run. It is gated on `isNewUser =
-- !existingProfile`, but THIS trigger is AFTER INSERT ON auth.users and
-- inserts the public.users row in the same transaction, so the row always
-- exists by the time the route reads it. Measured lag between
-- auth.users.created_at and public.users.created_at across all users: 0.000s.
-- Fixing the seed here fixes every signup path at once and needs no client
-- involvement.
--
-- NULLIF(TRIM(...), '') because an OAuth provider that sends an empty string
-- would otherwise satisfy COALESCE and produce a blank name.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    display_name,
    avatar_url,
    preferences,
    stats,
    privacy_settings,
    notification_settings,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
      SPLIT_PART(NEW.email, '@', 1)  -- last resort, for email signups
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'  -- Google sends `picture`
    ),
    '{}'::jsonb,
    '{
      "trips_created": 0,
      "destinations_visited": 0,
      "total_distance_km": 0,
      "countries_visited": 0
    }'::jsonb,
    '{
      "privateProfile": false,
      "showRealName": true,
      "showLocation": false
    }'::jsonb,
    '{
      "pushNotifications": true,
      "emailNotifications": true,
      "tripUpdates": true,
      "socialActivity": true
    }'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Backfill the users who already have a real name sitting unused in their
-- OAuth claims.
--
-- Deliberately narrow: only rows whose display_name is STILL exactly the email
-- local-part, i.e. the trigger's default that nobody has since edited. A user
-- who chose their own name is never touched. Matching is case-insensitive
-- because the default is written verbatim from the address.
UPDATE public.users u
SET display_name = NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''),
    updated_at   = NOW()
FROM auth.users au
WHERE au.id = u.id
  AND LOWER(u.display_name) = LOWER(SPLIT_PART(au.email, '@', 1))
  AND NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), '') IS NOT NULL;

-- Same for providers that send `name` rather than `full_name`.
UPDATE public.users u
SET display_name = NULLIF(TRIM(au.raw_user_meta_data->>'name'), ''),
    updated_at   = NOW()
FROM auth.users au
WHERE au.id = u.id
  AND LOWER(u.display_name) = LOWER(SPLIT_PART(au.email, '@', 1))
  AND NULLIF(TRIM(au.raw_user_meta_data->>'name'), '') IS NOT NULL;
