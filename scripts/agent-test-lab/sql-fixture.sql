-- LOCAL DISPOSABLE DATABASE ONLY. Never run this fixture against Supabase.
do $roles$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $roles$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table public.admin_users(id text primary key,role text,active boolean,password_changed_at timestamptz);
insert into public.admin_users values('admin-renato-lagares','super_admin',true,null);
create table public.lab_test_audit_log(id uuid default gen_random_uuid(), run_id uuid, status text);
create function public.append_operational_audit_event_v1(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,text,text,integer,integer,text,text,jsonb,jsonb,text)
returns void language sql as $$ insert into public.lab_test_audit_log(run_id,status) values($1,$11); $$;
grant insert on public.lab_test_audit_log to service_role;
grant select on public.admin_users to service_role;
