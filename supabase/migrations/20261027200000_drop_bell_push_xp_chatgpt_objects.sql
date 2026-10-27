-- What the notification bell, push notifications, live-trip XP and the
-- ChatGPT app left in the database. The app no longer reads or writes any of
-- it. No CASCADE, so anything still depending on these stops the migration.
-- Dropping notifications also takes it out of the realtime publication.

drop table if exists public.push_log;
drop table if exists public.device_tokens;
drop table if exists public.notifications;
drop table if exists public.mcp_itineraries;

drop function if exists public.award_gameplay_bananas(uuid, text, text, integer, uuid, integer, integer, text);
