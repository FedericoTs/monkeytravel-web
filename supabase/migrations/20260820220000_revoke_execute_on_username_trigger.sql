-- Drop the pointless EXECUTE grant on the username trigger function.
--
-- 20260820206000 made public.mt_users_set_username() SECURITY DEFINER so its
-- collision scan can see the whole table no matter who is inserting. That
-- combination — definer + EXECUTE held by anon/authenticated — is exactly what
-- the Supabase security advisor flags as
-- `anon_security_definer_function_executable`: a definer function reachable at
-- /rest/v1/rpc/mt_users_set_username.
--
-- It was not actually exploitable. Postgres refuses to invoke a trigger
-- function directly ("trigger functions can only be called as triggers"), so
-- the RPC call fails before the body runs. But the grant buys nothing: firing a
-- trigger does not re-check EXECUTE against the invoking role — only CREATE
-- TRIGGER does. handle_new_user, the sibling SECURITY DEFINER trigger on
-- auth.users, already has no such grant, so this only brings the two in line.
--
-- Verified after applying, by running the real signup path as `authenticated`
-- in a rolled-back transaction: a colliding display_name still produced
-- `thisisnoki-2`, so the trigger still fires and still sees every row.

revoke execute on function public.mt_users_set_username() from anon, authenticated, public;

notify pgrst, 'reload schema';
