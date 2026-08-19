-- Snapshot function behind the RLS drift check (scripts/rls-baseline.mts).
--
-- WHY: the 2026-08-19 audit found six tables anyone could write with the public
-- anon key, and 8 of the 10 offending policies existed in production but in NO
-- migration. ~130 live policies against 89 declared; only 34 of 88 migrations
-- touched RLS at all. Authorization was config no code review ever saw, and a
-- table could be opened from the Supabase UI with no diff and no alarm.
-- Closing those six fixed the instances. This is what addresses the cause: it
-- lets the whole authorization surface be pinned in git and compared.
--
-- Catalog-only (pg_policy / pg_class / aclexplode) rather than
-- information_schema, whose views filter rows by the querying role's own
-- privileges and would therefore report a different picture depending on who
-- asked. service_role only; anon and authenticated cannot call it.

CREATE OR REPLACE FUNCTION public.rls_snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_agg(t ORDER BY t->>'table')
  FROM (
    SELECT jsonb_build_object(
      'table', c.relname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'policies', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', p.polname,
          'cmd', CASE p.polcmd
                   WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                   WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
          'permissive', p.polpermissive,
          'roles', COALESCE(
            (SELECT array_agg(r.rolname ORDER BY r.rolname)
               FROM pg_roles r WHERE r.oid = ANY(p.polroles)),
            ARRAY['public']),
          'using', pg_get_expr(p.polqual, p.polrelid),
          'with_check', pg_get_expr(p.polwithcheck, p.polrelid)
        ) ORDER BY p.polname)
        FROM pg_policy p WHERE p.polrelid = c.oid
      ), '[]'::jsonb),
      'grants', COALESCE((
        SELECT jsonb_object_agg(g.rolname, g.privs)
        FROM (
          SELECT r.rolname,
                 array_agg(a.privilege_type ORDER BY a.privilege_type) AS privs
          FROM aclexplode(c.relacl) a
          JOIN pg_roles r ON r.oid = a.grantee
          WHERE r.rolname IN ('anon', 'authenticated')
            AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
          GROUP BY r.rolname
        ) g
      ), '{}'::jsonb)
    ) AS t
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
  ) x;
$$;

REVOKE ALL ON FUNCTION public.rls_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_snapshot() TO service_role;

COMMENT ON FUNCTION public.rls_snapshot() IS
  'Catalog-only snapshot of every public table RLS state, policies and anon/authenticated grants. Read by scripts/rls-baseline.mts to detect drift between production and the committed baseline. service_role only.';
