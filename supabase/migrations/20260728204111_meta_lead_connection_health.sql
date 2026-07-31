-- Health state for Meta Lead Ads onboarding.
--
-- A row existing in meta_connections no longer means that the integration is
-- operational. Only health_status = 'ready' may be presented as connected.

alter table public.meta_connections
  add column if not exists health_status text,
  add column if not exists health_code text,
  add column if not exists health_message text,
  add column if not exists granted_scopes text[] not null default '{}'::text[],
  add column if not exists page_tasks text[] not null default '{}'::text[],
  add column if not exists subscribed_fields text[] not null default '{}'::text[],
  add column if not exists token_expires_at timestamptz,
  add column if not exists data_access_expires_at timestamptz,
  add column if not exists token_kind text,
  add column if not exists client_business_id text,
  add column if not exists credential_fingerprint text,
  add column if not exists user_token_fingerprint text,
  add column if not exists lead_access_status text not null default 'unverified',
  add column if not exists last_lead_access_verified_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists next_health_check_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_webhook_at timestamptz,
  add column if not exists health_details jsonb not null default '{}'::jsonb;

create or replace function public.set_meta_connection_credential_fingerprint()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.credential_fingerprint := encode(
    extensions.digest(
      convert_to(
        coalesce(new.page_access_token, '') || chr(31) ||
        coalesce(new.user_access_token, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  new.user_token_fingerprint := encode(
    extensions.digest(
      convert_to(coalesce(new.user_access_token, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

drop trigger if exists meta_connections_credential_fingerprint_tg
  on public.meta_connections;
create trigger meta_connections_credential_fingerprint_tg
before insert or update of page_access_token, user_access_token
on public.meta_connections
for each row
execute function public.set_meta_connection_credential_fingerprint();

update public.meta_connections
set
  credential_fingerprint = encode(
    extensions.digest(
      convert_to(
        coalesce(page_access_token, '') || chr(31) ||
        coalesce(user_access_token, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  user_token_fingerprint = encode(
    extensions.digest(
      convert_to(coalesce(user_access_token, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
where credential_fingerprint is null
   or user_token_fingerprint is null;

alter table public.meta_connections
  alter column credential_fingerprint set not null,
  alter column user_token_fingerprint set not null;

alter table public.meta_connections
  drop constraint if exists meta_connections_credential_fingerprint_check;
alter table public.meta_connections
  add constraint meta_connections_credential_fingerprint_check
  check (credential_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.meta_connections
  drop constraint if exists meta_connections_user_token_fingerprint_check;
alter table public.meta_connections
  add constraint meta_connections_user_token_fingerprint_check
  check (user_token_fingerprint ~ '^[0-9a-f]{64}$');

revoke all on function public.set_meta_connection_credential_fingerprint()
  from public, anon, authenticated;

-- Existing connections remain operational during the one-time verification
-- rollout. New rows fail closed as unverified unless the OAuth callback moves
-- them through provisioning to ready.
update public.meta_connections
set
  health_status = 'legacy_grace',
  health_code = 'legacy_pending_verification',
  health_message = 'Conexão existente mantida ativa enquanto o MyChatCRM conclui a verificação.'
where health_status is null;

alter table public.meta_connections
  alter column health_status set default 'unverified',
  alter column health_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meta_connections_health_status_check'
      and conrelid = 'public.meta_connections'::regclass
  ) then
    alter table public.meta_connections
      add constraint meta_connections_health_status_check
      check (
        health_status in (
          'provisioning',
          'ready',
          'retrying',
          'action_required',
          'revoked',
          'unverified',
          'legacy_grace',
          'degraded'
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meta_connections_lead_access_status_check'
      and conrelid = 'public.meta_connections'::regclass
  ) then
    alter table public.meta_connections
      add constraint meta_connections_lead_access_status_check
      check (
        lead_access_status in (
          'unverified',
          'pending_first_lead',
          'verified_by_retrieval',
          'verified_by_delivery',
          'action_required'
        )
      );
  end if;
end
$$;

alter table public.meta_connections
  drop constraint if exists meta_connections_consecutive_failures_check;
alter table public.meta_connections
  add constraint meta_connections_consecutive_failures_check
  check (consecutive_failures >= 0);

-- A previously delivered webhook is durable proof that the app/page transport
-- and lead retrieval worked for that exact tenant/page at least once.
with delivered as (
  select tenant_id, page_id, max(updated_at) as delivered_at
  from public.meta_lead_events
  where steps_log @> '[{"step":"graph_data_fetched"}]'::jsonb
  group by tenant_id, page_id
)
update public.meta_connections as connection
set
  lead_access_status = 'verified_by_delivery',
  last_lead_access_verified_at = delivered.delivered_at,
  last_webhook_at = delivered.delivered_at,
  last_success_at = greatest(connection.updated_at, delivered.delivered_at)
from delivered
where delivered.tenant_id = connection.tenant_id
  and delivered.page_id = connection.page_id;

create index if not exists meta_connections_tenant_health_idx
  on public.meta_connections (tenant_id, health_status);
create index if not exists meta_connections_page_health_idx
  on public.meta_connections (page_id, health_status);
create index if not exists meta_connections_user_token_fingerprint_idx
  on public.meta_connections (user_token_fingerprint);
create index if not exists meta_connections_health_due_idx
  on public.meta_connections (next_health_check_at)
  where health_status <> 'revoked';

alter table public.meta_connections enable row level security;
drop policy if exists "tenant isolado" on public.meta_connections;
drop policy if exists "meta_connections_service_role_full_access" on public.meta_connections;
create policy "meta_connections_service_role_full_access"
  on public.meta_connections
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.meta_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.meta_connections to service_role;

comment on column public.meta_connections.health_status is
  'Operational state. Only ready means token, permissions, forms probe and leadgen subscription were verified.';
comment on column public.meta_connections.health_details is
  'Sanitized verification metadata only. Access tokens, phone numbers and lead data are forbidden here.';
comment on column public.meta_connections.credential_fingerprint is
  'Non-reversible SHA-256 used for optimistic credential CAS. Raw Meta tokens must never be sent as PostgREST filters.';
comment on column public.meta_connections.user_token_fingerprint is
  'Non-reversible SHA-256 used to count shared user-token references without exposing the raw token in URLs or query logs.';
comment on column public.meta_connections.last_webhook_at is
  'Most recent leadgen webhook observed for this tenant/page.';
comment on column public.meta_connections.lead_access_status is
  'Independent proof of lead retrieval/delivery. Page subscription alone does not prove customized Leads Access assignment.';

-- Durable grant-level state lets the periodic reconciler finish Page discovery
-- when Meta times out after OAuth. Without it, a partial /me/accounts response
-- would require the customer to reconnect manually because omitted Page IDs are
-- not yet known to meta_connections.
create table if not exists public.meta_lead_grants (
  tenant_id text primary key,
  user_access_token text not null,
  credential_fingerprint text not null,
  user_token_fingerprint text not null,
  token_kind text,
  token_mode text,
  client_business_id text,
  discovery_status text not null default 'pending'
    check (discovery_status in ('pending', 'discovering', 'ready', 'retrying', 'action_required')),
  last_error_code text,
  discovered_page_count integer not null default 0
    check (discovered_page_count >= 0),
  next_discovery_at timestamptz,
  last_discovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_lead_grants_credential_fingerprint_check
    check (credential_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint meta_lead_grants_user_token_fingerprint_check
    check (user_token_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint meta_lead_grants_token_mode_check
    check (
      token_mode is null
      or token_mode in ('business_integration_system_user', 'user')
    )
);

alter table public.meta_lead_grants
  add column if not exists user_token_fingerprint text,
  add column if not exists token_mode text;

create or replace function public.set_meta_lead_grant_fingerprints()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.credential_fingerprint := encode(
    extensions.digest(
      convert_to(chr(31) || coalesce(new.user_access_token, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  new.user_token_fingerprint := encode(
    extensions.digest(
      convert_to(coalesce(new.user_access_token, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

drop trigger if exists meta_lead_grants_fingerprints_tg
  on public.meta_lead_grants;
create trigger meta_lead_grants_fingerprints_tg
before insert or update of user_access_token
on public.meta_lead_grants
for each row
execute function public.set_meta_lead_grant_fingerprints();

update public.meta_lead_grants
set
  credential_fingerprint = encode(
    extensions.digest(
      convert_to(chr(31) || coalesce(user_access_token, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  user_token_fingerprint = encode(
    extensions.digest(
      convert_to(coalesce(user_access_token, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
where credential_fingerprint is null
   or user_token_fingerprint is null;

alter table public.meta_lead_grants
  alter column user_token_fingerprint set not null;

alter table public.meta_lead_grants
  drop constraint if exists meta_lead_grants_user_token_fingerprint_check;
alter table public.meta_lead_grants
  add constraint meta_lead_grants_user_token_fingerprint_check
  check (user_token_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.meta_lead_grants
  drop constraint if exists meta_lead_grants_token_mode_check;
alter table public.meta_lead_grants
  add constraint meta_lead_grants_token_mode_check
  check (
    token_mode is null
    or token_mode in ('business_integration_system_user', 'user')
  );

create index if not exists meta_lead_grants_discovery_due_idx
  on public.meta_lead_grants (next_discovery_at)
  where discovery_status in ('pending', 'discovering', 'retrying');
create index if not exists meta_lead_grants_user_token_fingerprint_idx
  on public.meta_lead_grants (user_token_fingerprint);

-- Preserve an actionable grant for tenants that were connected before this
-- migration. The most recently refreshed user token becomes the discovery
-- grant; older Page credentials remain independently health-checked.
with latest_connection as (
  select distinct on (tenant_id)
    tenant_id,
    user_access_token,
    token_kind,
    client_business_id,
    updated_at
  from public.meta_connections
  where nullif(user_access_token, '') is not null
  order by tenant_id, updated_at desc
),
page_counts as (
  select tenant_id, count(*)::integer as page_count
  from public.meta_connections
  group by tenant_id
)
insert into public.meta_lead_grants (
  tenant_id,
  user_access_token,
  credential_fingerprint,
  user_token_fingerprint,
  token_kind,
  client_business_id,
  discovery_status,
  discovered_page_count,
  last_discovered_at,
  created_at,
  updated_at
)
select
  latest.tenant_id,
  latest.user_access_token,
  encode(
    extensions.digest(
      convert_to(chr(31) || latest.user_access_token, 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  encode(
    extensions.digest(convert_to(latest.user_access_token, 'UTF8'), 'sha256'),
    'hex'
  ),
  latest.token_kind,
  latest.client_business_id,
  'ready',
  counts.page_count,
  latest.updated_at,
  latest.updated_at,
  latest.updated_at
from latest_connection latest
join page_counts counts on counts.tenant_id = latest.tenant_id
on conflict (tenant_id) do nothing;

alter table public.meta_lead_grants enable row level security;
drop policy if exists "meta_lead_grants_service_role_full_access"
  on public.meta_lead_grants;
create policy "meta_lead_grants_service_role_full_access"
  on public.meta_lead_grants
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.meta_lead_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.meta_lead_grants
  to service_role;

revoke all on function public.set_meta_lead_grant_fingerprints()
  from public, anon, authenticated;

comment on table public.meta_lead_grants is
  'Private durable Meta OAuth grant state used to complete interrupted Page discovery without asking the customer to reconnect.';
comment on column public.meta_lead_grants.user_token_fingerprint is
  'Non-reversible SHA-256 used for cross-tenant reference checks without placing raw access tokens in request URLs.';

-- Atomically verifies that an asset-discovery worker still owns the current
-- OAuth grant before it may refresh Page credentials. A stale worker can never
-- overwrite a newer customer reconnection.
create or replace function public.upsert_meta_grant_discovered_pages(
  p_tenant_id text,
  p_expected_grant_fingerprint text,
  p_pages jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  grant_row public.meta_lead_grants%rowtype;
  page_value jsonb;
  page_id_value text;
  page_name_value text;
  page_token_value text;
  new_credential_fingerprint text;
begin
  if p_tenant_id is null
     or p_expected_grant_fingerprint !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(p_pages, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_meta_grant_page_batch';
  end if;

  select *
  into grant_row
  from public.meta_lead_grants
  where tenant_id = p_tenant_id
    and credential_fingerprint = p_expected_grant_fingerprint
  for update;

  if not found then
    return false;
  end if;

  for page_value in
    select value
    from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb))
  loop
    page_id_value := nullif(btrim(page_value ->> 'page_id'), '');
    page_name_value := nullif(btrim(page_value ->> 'page_name'), '');
    page_token_value := nullif(btrim(page_value ->> 'page_access_token'), '');

    if page_id_value is null
       or page_name_value is null
       or page_token_value is null
       or length(page_id_value) > 255
       or length(page_name_value) > 500 then
      raise exception 'invalid_meta_grant_page';
    end if;

    new_credential_fingerprint := encode(
      extensions.digest(
        convert_to(
          page_token_value || chr(31) || grant_row.user_access_token,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    insert into public.meta_connections (
      tenant_id,
      page_id,
      page_name,
      page_access_token,
      user_access_token,
      token_kind,
      client_business_id,
      credential_fingerprint,
      user_token_fingerprint,
      health_status,
      health_code,
      health_message,
      lead_access_status,
      next_health_check_at,
      updated_at
    )
    values (
      grant_row.tenant_id,
      page_id_value,
      page_name_value,
      page_token_value,
      grant_row.user_access_token,
      grant_row.token_kind,
      grant_row.client_business_id,
      new_credential_fingerprint,
      grant_row.user_token_fingerprint,
      'provisioning',
      'oauth_credentials_changed',
      'Credenciais recebidas. A conexão está sendo verificada.',
      'unverified',
      now(),
      now()
    )
    on conflict (tenant_id, page_id) do update
    set
      page_name = excluded.page_name,
      page_access_token = excluded.page_access_token,
      user_access_token = excluded.user_access_token,
      token_kind = excluded.token_kind,
      client_business_id = excluded.client_business_id,
      credential_fingerprint = excluded.credential_fingerprint,
      user_token_fingerprint = excluded.user_token_fingerprint,
      health_status = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.health_status
        else 'provisioning'
      end,
      health_code = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.health_code
        else 'oauth_credentials_changed'
      end,
      health_message = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.health_message
        else 'Credenciais recebidas. A conexão está sendo verificada.'
      end,
      granted_scopes = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.granted_scopes
        else '{}'::text[]
      end,
      page_tasks = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.page_tasks
        else '{}'::text[]
      end,
      subscribed_fields = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.subscribed_fields
        else '{}'::text[]
      end,
      lead_access_status = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.lead_access_status
        else 'unverified'
      end,
      token_expires_at = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.token_expires_at
        else null
      end,
      data_access_expires_at = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.data_access_expires_at
        else null
      end,
      last_verified_at = case
        when public.meta_connections.credential_fingerprint =
             excluded.credential_fingerprint
          then public.meta_connections.last_verified_at
        else null
      end,
      next_health_check_at = now(),
      updated_at = now();
  end loop;

  return true;
end;
$$;

revoke all on function public.upsert_meta_grant_discovered_pages(
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.upsert_meta_grant_discovered_pages(
  text,
  text,
  jsonb
) to service_role;
