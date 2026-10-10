-- API request logs are read on the server only (the admin dashboards and the
-- spend alert, with the service role). The SELECT policy was `true` for every
-- signed-in user, so anyone could list other users' ids, trips and searches.
drop policy api_request_logs_authenticated_select on public.api_request_logs;

revoke select on public.api_request_logs from public, anon, authenticated;
