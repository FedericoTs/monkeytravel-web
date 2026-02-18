-- Enable Realtime for proposal tables
-- Without this, postgres_changes subscriptions in useProposals.ts receive nothing
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_proposals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.proposal_votes;
