-- The invite lookups are service-role only. Both return the invite's
-- recipient_email and the inviter's note, and anon and authenticated could
-- call them with the public key. Every caller (app/api/invites/[token], its
-- sign-in-link route and the /invite/[token] page) uses the service role.
-- PUBLIC is revoked too, so a grant held through it cannot survive.

revoke execute on function public.get_invite_by_token(text) from public, anon, authenticated;
grant execute on function public.get_invite_by_token(text) to service_role;

revoke execute on function public.get_invite_status_by_token(text) from public, anon, authenticated;
grant execute on function public.get_invite_status_by_token(text) to service_role;

comment on function public.get_invite_by_token(text) is
  'One usable invite (active, not expired, not used up) by token, at most one row. Service role only: it returns recipient_email and the inviter''s note.';

comment on function public.get_invite_status_by_token(text) is
  'One invite by token whatever its state, so the invite page can say expired, revoked or used up. Service role only: it returns recipient_email and the inviter''s note.';

notify pgrst, 'reload schema';
