-- Who may pass during maintenance is not public. Anyone could read site_config whole
-- with the public key, allowed_emails and updated_by included. Visitors now read only
-- what the maintenance page shows; the app reads the rest with the service role.
--
-- From PUBLIC too: a revoke from anon and authenticated alone leaves what they inherit.

revoke select on table public.site_config from public, anon, authenticated;

grant select (id, maintenance_mode, maintenance_message, maintenance_title, maintenance_started_at)
  on table public.site_config to anon, authenticated;
