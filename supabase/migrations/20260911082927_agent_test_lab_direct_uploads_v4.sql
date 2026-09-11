-- Additive: legacy files were verified by the server before insertion.
alter table public.agent_test_lab_assets
 add column upload_status text not null default 'ready'
 check (upload_status in ('pending','ready','rejected'));

-- All enqueue versions must reject incomplete uploads, not just the newest API.
create or replace function private.guard_agent_test_lab_step_asset_v4()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare asset_id uuid; owner_id text;
begin
 if new.command ? 'assetId' then
   begin asset_id := (new.command->>'assetId')::uuid;
   exception when invalid_text_representation then raise exception 'asset_unavailable'; end;
   select owner_admin_id into owner_id from public.agent_test_lab_runs where id=new.run_id;
   if not exists(select 1 from public.agent_test_lab_assets a
     where a.id=asset_id and a.owner_admin_id=owner_id
       and a.upload_status='ready' and a.expires_at>now() and (new.kind='media' or a.kind=new.kind)
       and (a.run_id is null or a.run_id=new.run_id)) then
     raise exception 'asset_unavailable';
   end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_agent_test_lab_step_asset_v4() from public, anon, authenticated;
grant execute on function private.guard_agent_test_lab_step_asset_v4() to service_role;
create trigger agent_test_lab_step_asset_v4 before insert or update of command,kind,run_id
 on public.agent_test_lab_steps for each row execute function private.guard_agent_test_lab_step_asset_v4();

-- Cover laboratory-only foreign keys used by retention, billing and evidence.
create index agent_test_lab_assets_run on public.agent_test_lab_assets(run_id);
create index agent_test_lab_assets_expiry on public.agent_test_lab_assets(expires_at);
create index agent_test_lab_costs_run on public.agent_test_lab_costs(run_id);
create index agent_test_lab_resources_run on public.agent_test_lab_resources(run_id);
create index agent_test_lab_runs_isolated_agent on public.agent_test_lab_runs(isolated_agent_id);
