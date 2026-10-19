-- share_link_created rows from the owner's share route carried the trip's
-- share token in their metadata. Whoever holds a token can open the trip, so
-- analytics keep no copy of it; the route now logs a { via } marker instead.

update public.funnel_events
set metadata = metadata - 'share_token'
where metadata ? 'share_token';
