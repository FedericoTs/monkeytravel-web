-- Daily limits on the paid APIs: well above a normal day, so they only stop a
-- runaway. lib/api-gateway/api-control.ts enforces daily_limit; change one here
-- or through /api/admin/api-config.
insert into public.api_config (api_name, display_name, description, enabled, block_mode, category, cost_per_request, daily_limit)
values ('google_places_photo', 'Place Photos', 'Photo downloads from Google Places', true, 'none', 'google', 0.007, 800)
on conflict (api_name) do update set daily_limit = excluded.daily_limit;

update public.api_config set daily_limit = 400 where api_name in ('google_places_details', 'google_places_search');
update public.api_config set daily_limit = 500 where api_name = 'gemini';
