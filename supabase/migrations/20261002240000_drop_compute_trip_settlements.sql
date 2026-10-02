-- Settle Up computes its transfers in the settlements route (lib/expenses),
-- so this function has no callers left. It ran as the caller and anyone could
-- execute it; dropping it removes an unused entry point.
drop function public.compute_trip_settlements(uuid);
