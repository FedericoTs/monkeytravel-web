-- The app's database schema, written as SQL a fresh local Supabase stack can
-- load: extensions, sequences, functions, tables, views, constraints, indexes,
-- triggers, row-level security, policies, grants, realtime tables and storage
-- buckets, in an order that loads. Email addresses become a placeholder.
with recursive
fn as (
  select p.oid, p.prokind,
    exists (
      select 1 from pg_type t
      where t.typrelid <> 0 and t.typnamespace = 'public'::regnamespace
        and (t.oid = p.prorettype or t.oid = any (p.proargtypes::oid[]) or t.oid = any (coalesce(p.proallargtypes, '{}'::oid[])))
    ) as needs_relations
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),
rel as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.reloptions, c.relacl, c.relowner
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S')
    and c.relname not like 'zz\_ci\_%'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
),
roles as (
  select oid, rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
  union all select 0, 'PUBLIC'
),
view_deps as (
  select distinct v.oid as view_oid, dep.oid as dep_oid
  from rel v
  join pg_rewrite r on r.ev_class = v.oid
  join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
  join rel dep on dep.oid = d.refobjid and dep.relkind in ('v', 'm') and dep.oid <> v.oid
  where v.relkind in ('v', 'm')
),
view_depth (oid, depth) as (
  select oid, 0 from rel where relkind in ('v', 'm') and oid not in (select view_oid from view_deps)
  union all
  select d.view_oid, vd.depth + 1 from view_deps d join view_depth vd on vd.oid = d.dep_oid where vd.depth < 20
),
sections as (
  select 1 as ord, E'-- Generated from production by supabase/ci/snapshot.sql. Do not edit by hand.\nSET check_function_bodies = false;\nSET client_min_messages = warning;\nSET search_path = public, extensions;' as ddl
  union all
  select 2, string_agg(format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', e.extname, n.nspname), E'\n' order by e.extname)
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql', 'pg_cron', 'pg_stat_statements', 'supabase_vault', 'pg_graphql', 'pgsodium', 'pg_net')
  union all
  select 3, string_agg(format('CREATE SEQUENCE IF NOT EXISTS public.%I AS %s START WITH %s INCREMENT BY %s MINVALUE %s MAXVALUE %s CACHE %s%s;',
      r.relname, format_type(s.seqtypid, null), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, case when s.seqcycle then ' CYCLE' else '' end), E'\n' order by r.relname)
  from rel r join pg_sequence s on s.seqrelid = r.oid
  where r.relkind = 'S' and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = r.oid and d.deptype = 'i')
  union all
  select 4, string_agg(rtrim(pg_get_functiondef(f.oid), E'\n') || ';', E'\n\n' order by f.oid)
  from fn f where not f.needs_relations
  union all
  select 5, string_agg(t.ddl, E'\n\n' order by t.relname) from (
    select r.relname, format(E'CREATE TABLE public.%I (\n%s\n);', r.relname,
      string_agg(format('  %I %s%s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
        case when a.attidentity in ('a', 'd') then ' GENERATED ' || case a.attidentity when 'a' then 'ALWAYS' else 'BY DEFAULT' end || ' AS IDENTITY' else '' end,
        case when a.attgenerated = 's' then ' GENERATED ALWAYS AS (' || pg_get_expr(ad.adbin, ad.adrelid) || ') STORED'
             when ad.adbin is not null then ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) else '' end,
        case when a.attnotnull then ' NOT NULL' else '' end), E',\n' order by a.attnum)) as ddl
    from rel r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef ad on ad.adrelid = r.oid and ad.adnum = a.attnum
    where r.relkind = 'r'
    group by r.relname
  ) t
  union all
  select 6, string_agg(rtrim(pg_get_functiondef(f.oid), E'\n') || ';', E'\n\n' order by f.oid)
  from fn f where f.needs_relations
  union all
  select 7, string_agg(format('ALTER SEQUENCE public.%I OWNED BY public.%I.%I;', s.relname, t.relname, a.attname), E'\n' order by s.relname)
  from rel s
  join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = s.oid and d.deptype = 'a'
  join pg_class t on t.oid = d.refobjid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
  where s.relkind = 'S'
  union all
  select 8, string_agg(case r.relkind
      when 'v' then format(E'CREATE VIEW public.%I%s AS\n%s;', r.relname,
        case when r.reloptions is not null then ' WITH (' || array_to_string(r.reloptions, ', ') || ')' else '' end,
        rtrim(rtrim(pg_get_viewdef(r.oid, true), E'\n'), ';'))
      else format(E'CREATE MATERIALIZED VIEW public.%I AS\n%s\nWITH DATA;', r.relname, rtrim(rtrim(pg_get_viewdef(r.oid, true), E'\n'), ';'))
    end, E'\n\n' order by vd.depth, r.relname)
  from rel r join (select oid, max(depth) as depth from view_depth group by oid) vd on vd.oid = r.oid
  union all
  select 9, string_agg(format('ALTER TABLE ONLY public.%I ADD CONSTRAINT %I %s;', r.relname, c.conname, pg_get_constraintdef(c.oid)), E'\n'
      order by case c.contype when 'p' then 0 when 'u' then 1 when 'x' then 2 when 'c' then 3 else 4 end, r.relname, c.conname)
  from pg_constraint c join rel r on r.oid = c.conrelid
  where c.contype in ('p', 'u', 'x', 'c', 'f')
  union all
  select 10, string_agg(pg_get_indexdef(i.indexrelid) || ';', E'\n' order by ic.relname)
  from pg_index i join rel r on r.oid = i.indrelid join pg_class ic on ic.oid = i.indexrelid
  where not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid and c.conrelid = i.indrelid)
  union all
  select 11, string_agg(pg_get_triggerdef(t.oid) || ';', E'\n' order by t.tgname)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and (c.oid in (select oid from rel) or (c.relnamespace = 'auth'::regnamespace and c.relname = 'users'))
  union all
  select 12, string_agg(
      format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.relname)
      || case when r.relforcerowsecurity then format(E'\nALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.relname) else '' end, E'\n' order by r.relname)
  from rel r where r.relkind = 'r' and r.relrowsecurity
  union all
  select 13, string_agg(format('ALTER TABLE public.%I REPLICA IDENTITY FULL;', r.relname), E'\n' order by r.relname)
  from rel r where r.relkind = 'r' and r.relreplident = 'f'
  union all
  select 14, string_agg(
      case when n.nspname <> 'public' then format(E'DROP POLICY IF EXISTS %I ON %I.%I;\n', pol.polname, n.nspname, c.relname) else '' end
      || format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;', pol.polname, n.nspname, c.relname,
        case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
        case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
        (select string_agg(case when x.role_oid = 0 then 'public' else quote_ident(pr.rolname) end, ', ' order by x.ord)
           from unnest(pol.polroles) with ordinality x(role_oid, ord) left join pg_roles pr on pr.oid = x.role_oid),
        case when pol.polqual is not null then ' USING (' || pg_get_expr(pol.polqual, pol.polrelid) || ')' else '' end,
        case when pol.polwithcheck is not null then ' WITH CHECK (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')' else '' end),
      E'\n' order by n.nspname, c.relname, pol.polname)
  from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
  where c.oid in (select oid from rel) or n.nspname = 'storage'
  union all
  select 15, string_agg(g.ddl, E'\n' order by g.relname, g.ord) from (
    select r.relname, 0 as ord, format('REVOKE ALL ON %s public.%I FROM PUBLIC, anon, authenticated, service_role;',
      case when r.relkind = 'S' then 'SEQUENCE' else 'TABLE' end, r.relname) as ddl
    from rel r
    union all
    select r.relname, 1, format('GRANT %s ON %s public.%I TO %s;', string_agg(acl.privilege_type, ', ' order by acl.privilege_type),
      case when r.relkind = 'S' then 'SEQUENCE' else 'TABLE' end, r.relname, ro.rolname)
    from rel r
    cross join lateral aclexplode(coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's'::"char" else 'r'::"char" end, r.relowner))) acl
    join roles ro on ro.oid = acl.grantee
    group by r.relname, r.relkind, ro.rolname
    union all
    select r.relname, 2, format('GRANT %s (%s) ON TABLE public.%I TO %s;', x.privilege_type,
      string_agg(quote_ident(x.attname), ', ' order by x.attnum), r.relname, ro.rolname)
    from rel r
    cross join lateral (
      select a.attname, a.attnum, acl.grantee, acl.privilege_type
      from pg_attribute a cross join lateral aclexplode(a.attacl) acl
      where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
    ) x
    join roles ro on ro.oid = x.grantee
    group by r.relname, ro.rolname, x.privilege_type
  ) g
  union all
  select 16, string_agg(g.ddl, E'\n' order by g.fname, g.ord) from (
    select p.proname as fname, 0 as ord, format('REVOKE ALL ON %s public.%I(%s) FROM PUBLIC, anon, authenticated, service_role;',
      case when p.prokind = 'p' then 'PROCEDURE' else 'FUNCTION' end, p.proname, pg_get_function_identity_arguments(p.oid)) as ddl
    from fn f join pg_proc p on p.oid = f.oid
    union all
    select p.proname, 1, format('GRANT EXECUTE ON %s public.%I(%s) TO %s;',
      case when p.prokind = 'p' then 'PROCEDURE' else 'FUNCTION' end, p.proname, pg_get_function_identity_arguments(p.oid), ro.rolname)
    from fn f join pg_proc p on p.oid = f.oid
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    join roles ro on ro.oid = acl.grantee
    where acl.privilege_type = 'EXECUTE'
  ) g
  union all
  select 17, string_agg(format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', pt.tablename), E'\n' order by pt.tablename)
  from pg_publication_tables pt where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public'
  union all
  select 18, string_agg(format('INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (%L, %L, %L, %s, %L) ON CONFLICT (id) DO NOTHING;',
      b.id, b.name, b.public, coalesce(b.file_size_limit::text, 'NULL'), b.allowed_mime_types), E'\n' order by b.id)
  from storage.buckets b
  union all
  select 19, format('-- latest migration: %s', (select max(version) from supabase_migrations.schema_migrations))
)
select regexp_replace(
  string_agg(ddl, E'\n\n' order by ord),
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'ci-admin@example.invalid', 'g'
) || E'\n' as ddl
from sections where ddl is not null
