-- A referral code is readable by its owner only. The policy was `true`, so
-- anyone with the public key could list every code with its owner's user id
-- and stats. The join page, click tracking and referral completion read
-- other people's codes on the server with the service role.
drop policy referral_codes_select_consolidated on public.referral_codes;

create policy referral_codes_select_own on public.referral_codes
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke select on public.referral_codes from anon;
