-- Catálogo de integrações externas: sincronização periódica, genérica.
-- Nenhuma coluna aqui presume o nicho do tenant — campo específico de negócio
-- vai em `attributes` (jsonb livre), preenchido pelo mesmo mapeamento que já
-- existe hoje em external_api_operations.response_mapping.attributes.

-- 1) Conector: novo tipo de auth OAuth2 client-credentials (reaproveita
--    auth_config jsonb, já existente e sem uso hoje, pra token_url/client_id —
--    client_secret vai no credential_ciphertext que já existe, mesma
--    criptografia de bearer/api_key/basic) + campos de sincronização.
alter table public.external_api_connectors
  drop constraint if exists external_api_connectors_auth_type_check;
alter table public.external_api_connectors
  add constraint external_api_connectors_auth_type_check
  check (auth_type in ('none', 'bearer', 'api_key', 'basic', 'oauth2_client_credentials'));

alter table public.external_api_connectors
  add column if not exists environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  add column if not exists sync_enabled boolean not null default false,
  add column if not exists sync_operation_key text
    check (sync_operation_key is null or sync_operation_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  add column if not exists sync_frequency_minutes integer
    check (sync_frequency_minutes is null or sync_frequency_minutes in (30, 60, 180, 360, 720, 1440)),
  add column if not exists last_sync_at timestamptz null,
  add column if not exists last_sync_status text
    check (last_sync_status is null or last_sync_status in ('success', 'error')),
  add column if not exists last_sync_error text null,
  add column if not exists last_sync_item_count integer
    check (last_sync_item_count is null or last_sync_item_count >= 0);

-- Sync ligado sem operação-fonte escolhida não significa nada — mesma regra
-- de "meia-configuração não faz nada" já usada em outras features do app.
alter table public.external_api_connectors
  drop constraint if exists external_api_connectors_sync_requires_operation;
alter table public.external_api_connectors
  add constraint external_api_connectors_sync_requires_operation
  check (sync_enabled = false or sync_operation_key is not null);

-- 2) Operação: paginação — só usada pelo motor de sincronização (a consulta
--    ao vivo do agente durante a conversa continua página única).
alter table public.external_api_operations
  add column if not exists pagination jsonb not null default '{"mode":"none"}'::jsonb;

-- 3) Token OAuth2 em cache — nunca texto puro, ao contrário de outras
--    integrações OAuth do app hoje (Meta, Google Calendar).
create table if not exists public.external_api_oauth_tokens (
  connector_id uuid primary key,
  tenant_id text not null,
  access_token_ciphertext text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  foreign key (connector_id, tenant_id)
    references public.external_api_connectors (id, tenant_id)
    on delete cascade
);

-- 4) Catálogo interno normalizado e sincronizado. Só campo praticamente
--    universal a qualquer catálogo vira coluna; o resto é `attributes`.
create table if not exists public.external_api_catalog_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  connector_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 300),
  title text check (title is null or char_length(title) <= 500),
  description text check (description is null or char_length(description) <= 5000),
  price numeric,
  currency text check (currency is null or char_length(currency) <= 10),
  availability text check (availability is null or char_length(availability) <= 100),
  link text check (link is null or char_length(link) <= 2048),
  media jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, connector_id, external_id),
  foreign key (connector_id, tenant_id)
    references public.external_api_connectors (id, tenant_id)
    on delete cascade
);
create index if not exists external_api_catalog_items_tenant_connector_active_idx
  on public.external_api_catalog_items (tenant_id, connector_id, is_active);
create index if not exists external_api_catalog_items_attributes_gin_idx
  on public.external_api_catalog_items using gin (attributes);

-- 5) Auditoria de CONFIGURAÇÃO do conector — distinto de external_api_call_logs,
--    que audita cada CHAMADA. Molde: admin_ia_audit_log.
create table if not exists public.external_api_connector_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  connector_id uuid,
  actor_id text,
  action text not null check (char_length(action) <= 100),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists external_api_connector_audit_log_tenant_created_idx
  on public.external_api_connector_audit_log (tenant_id, created_at desc);

alter table public.external_api_oauth_tokens enable row level security;
alter table public.external_api_catalog_items enable row level security;
alter table public.external_api_connector_audit_log enable row level security;

revoke all on table public.external_api_oauth_tokens from anon, authenticated;
revoke all on table public.external_api_catalog_items from anon, authenticated;
revoke all on table public.external_api_connector_audit_log from anon, authenticated;

grant select, insert, update, delete on table public.external_api_oauth_tokens to service_role;
grant select, insert, update, delete on table public.external_api_catalog_items to service_role;
grant select, insert, update, delete on table public.external_api_connector_audit_log to service_role;

comment on table public.external_api_catalog_items is
  'Catálogo normalizado sincronizado por conector. Genérico — attributes guarda campo específico de cada negócio, nunca coluna dedicada.';
comment on table public.external_api_connector_audit_log is
  'Auditoria de mudança de configuração do conector (criar/editar/girar credencial/sync). Distinto de external_api_call_logs, que audita cada chamada.';
comment on table public.external_api_oauth_tokens is
  'Access token OAuth2 em cache, sempre criptografado — nunca texto puro.';
