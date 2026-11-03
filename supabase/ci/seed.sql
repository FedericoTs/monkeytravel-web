-- Rows the signed-in tests read that production has and a fresh stack doesn't:
-- the site config, and a public trip on /explore. Runs after
-- scripts/e2e-fixtures.mts; the fixtures' second account is the trip's author.
insert into public.site_config default values on conflict (id) do nothing;

do $$
begin
  insert into public.trips (user_id, title, description, start_date, end_date, status, visibility, shared_at, submitted_to_trending_at)
  select id, 'Lisbon long weekend', 'Three days of tiles, trams and custard tarts.',
    current_date + 30, current_date + 32, 'planning', 'public', now(), now()
  from public.users
  where email = 'mt-e2e+test-mate@test.local';
  if not found then
    raise exception 'no fixture account to author the public trip';
  end if;
end $$;
