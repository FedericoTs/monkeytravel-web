-- Today's live channel (trip-today:<trip id>) becomes private: anyone may
-- listen, as before, but only the server (service role, which bypasses RLS)
-- may send. As a public channel, anyone with the public key could send
-- "changed" and make every open Today screen refetch. There is no INSERT
-- policy on purpose: clients cannot send on these topics.
create policy "Anyone can listen on Today channels"
  on realtime.messages
  for select
  to anon, authenticated
  using (realtime.topic() like 'trip-today:%' and realtime.messages.extension = 'broadcast');
