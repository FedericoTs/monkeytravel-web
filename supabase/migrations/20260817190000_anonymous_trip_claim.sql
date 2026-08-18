-- Anonymous share loop (2026-08-17)
--
-- WHY: the crew loop dies at hop one. An anonymous planner can generate a trip
-- but cannot share it, because persistTrip hard-writes user_id and the share
-- route requires an authenticated owner. Only 55 of 323 trips (17%) have ever
-- had a share token. This lets an anonymous planner mint ONE read-only share
-- link, and claim the trip later by signing up.
--
-- DELIBERATELY NOT CHANGED: the four RLS policies on `trips`.
--   * trips_insert_own still requires user_id = auth.uid(), so the anon role
--     CANNOT insert rows with the public key. Ownerless trips are created
--     server-side with the service-role client, behind a rate-limited route.
--     Opening INSERT to `user_id IS NULL` would have been a spam faucet.
--   * trips_update / trips_delete_own already require ownership, and
--     `NULL = auth.uid()` evaluates to NULL (never true) — so editing and
--     deleting an ownerless trip is already impossible for every caller that
--     goes through RLS. "Editing is members-only" needs no new policy.
--   * trips_select_consolidated already permits `share_token IS NOT NULL`,
--     so /shared/[token] renders an ownerless trip with no policy change.

-- Secret handed to the anonymous creator's browser. Whoever holds it can take
-- ownership exactly once. Not the share token: the share token is public and
-- read-only, this one confers ownership, so they must never be the same value.
alter table public.trips
  add column if not exists claim_token text,
  add column if not exists claim_expires_at timestamptz;

-- Partial unique index: only unclaimed rows carry a token, and claimed rows
-- (NULL) must not collide with each other.
create unique index if not exists trips_claim_token_key
  on public.trips (claim_token)
  where claim_token is not null;

-- Sweeper support: find expired, still-unclaimed, still-ownerless rows cheaply.
create index if not exists trips_unclaimed_expiry_idx
  on public.trips (claim_expires_at)
  where user_id is null and claim_token is not null;

comment on column public.trips.claim_token is
  'Single-use secret that lets an anonymous creator take ownership at signup. Cleared on claim. Never exposed on /shared/[token].';
comment on column public.trips.claim_expires_at is
  'After this, an unclaimed ownerless trip is eligible for deletion by the sweeper.';

-- Atomic claim. Doing this as read-then-update in the route would race two
-- concurrent signups on the same token and could hand one trip to two users,
-- the same class of TOCTOU bug already fixed in accept_invite and
-- insert_trip_dedup. The single UPDATE with the token in the WHERE clause is
-- the lock: the second caller matches zero rows and gets claimed=false.
create or replace function public.claim_anonymous_trip(
  p_claim_token text,
  p_user_id uuid
)
returns table (claimed boolean, trip_id uuid, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  if p_claim_token is null or length(p_claim_token) < 20 then
    return query select false, null::uuid, 'invalid_token';
    return;
  end if;

  if p_user_id is null then
    return query select false, null::uuid, 'not_authenticated';
    return;
  end if;

  update public.trips t
     set user_id          = p_user_id,
         claim_token      = null,
         claim_expires_at = null,
         updated_at       = now()
   where t.claim_token = p_claim_token
     and t.user_id is null
     and t.deleted_at is null
     and (t.claim_expires_at is null or t.claim_expires_at > now())
  returning t.id into v_trip_id;

  if v_trip_id is null then
    -- Already claimed, expired, deleted, or never existed. Deliberately one
    -- opaque reason: distinguishing them would let a caller probe tokens.
    return query select false, null::uuid, 'unavailable';
    return;
  end if;

  return query select true, v_trip_id, null::text;
end;
$$;

-- Callable by signed-in users only. anon must never reach it: the whole point
-- is that claiming converts an anonymous trip into an owned one, and a prior
-- audit found 39 SECURITY DEFINER functions executable by anon, so be explicit.
revoke all on function public.claim_anonymous_trip(text, uuid) from public, anon;
grant execute on function public.claim_anonymous_trip(text, uuid) to authenticated, service_role;

comment on function public.claim_anonymous_trip(text, uuid) is
  'Atomically transfer an ownerless trip to a signed-in user. Single-use; returns claimed=false for any already-claimed, expired or unknown token.';
