-- Wikimedia Commons photos for destination covers and galleries, stored once
-- and served by /api/images/wikimedia (lib/images/wikimedia.ts). Private: only
-- the server reads and writes it, with the service role, so no policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('destination-images', 'destination-images', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
