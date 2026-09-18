-- Páginas de captura + carteira de créditos + domínios
--
-- Por que isto existe: o MyChatCRM só sabia receber lead da Meta, que entrega
-- formulário nativo. O Google não entrega — quem anuncia lá precisa de página.
-- Sem página, o produto está proibido de existir no maior canal de tráfego pago
-- do mundo. A página é o adaptador que faltava, não um produto novo.
--
-- Três assuntos, uma migração, porque nascem acoplados: a página só publica se
-- houver crédito, e só serve num domínio.
--
-- Tudo idempotente (`if not exists`): a Central de Leads provou que migração
-- que não pode ser reaplicada vira noite perdida.

create schema if not exists private;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Carteira de créditos
-- ---------------------------------------------------------------------------
-- Moeda universal do produto, não só das páginas. O padrão "comprou avulso →
-- vira saldo" já existia em `tenant_billing_entitlements` (lead_capacity_topup);
-- aqui ele vira ledger de verdade: append-only, saldo derivado, débito
-- idempotente.

create table if not exists public.credit_wallets (
  tenant_id text primary key,
  balance integer not null default 0 check (balance >= 0),
  lifetime_granted bigint not null default 0 check (lifetime_granted >= 0),
  lifetime_spent bigint not null default 0 check (lifetime_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  /** Positivo = crédito comprado/concedido. Negativo = consumo. Nunca zero. */
  delta integer not null check (delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  ref_type text null,
  ref_id text null,
  /**
   * Trava de repetição. O webhook do Stripe reenvia o mesmo evento; o botão de
   * gerar página é clicado duas vezes. Nos dois casos a segunda tentativa tem
   * de ser silenciosamente ignorada, não cobrada de novo.
   */
  idempotency_key text not null,
  actor text null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists credit_ledger_tenant_idx
  on public.credit_ledger (tenant_id, created_at desc);

alter table public.credit_wallets enable row level security;
alter table public.credit_ledger enable row level security;
revoke all on public.credit_wallets from public, anon, authenticated;
revoke all on public.credit_ledger from public, anon, authenticated;
grant select, insert, update on public.credit_wallets to service_role;
grant select, insert on public.credit_ledger to service_role;

/**
 * Movimento de saldo numa transação só.
 *
 * Devolve `applied=false` quando a chave de idempotência já foi usada (repetição
 * benigna) e quando o saldo é insuficiente — quem chama distingue pelo campo
 * `reason_code`. Nunca levanta exceção por saldo: falta de crédito é resposta
 * de negócio, não erro de sistema.
 */
create or replace function public.credits_move_v1(
  p_tenant_id text,
  p_delta integer,
  p_reason text,
  p_idempotency_key text,
  p_ref_type text default null,
  p_ref_id text default null,
  p_actor text default null
)
returns table (applied boolean, balance integer, reason_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
  v_existing public.credit_ledger%rowtype;
begin
  if p_delta = 0 then
    select w.balance into v_balance from public.credit_wallets w where w.tenant_id = p_tenant_id;
    return query select false, coalesce(v_balance, 0), 'zero_delta'::text;
    return;
  end if;

  -- Repetição: devolve o saldo daquele momento, não cobra de novo.
  select * into v_existing
    from public.credit_ledger
   where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    return query select false, v_existing.balance_after, 'duplicate'::text;
    return;
  end if;

  insert into public.credit_wallets (tenant_id, balance)
  values (p_tenant_id, 0)
  on conflict (tenant_id) do nothing;

  -- Trava a linha: dois cliques simultâneos não podem ler o mesmo saldo.
  select w.balance into v_balance
    from public.credit_wallets w
   where w.tenant_id = p_tenant_id
     for update;

  if p_delta < 0 and v_balance + p_delta < 0 then
    return query select false, v_balance, 'insufficient'::text;
    return;
  end if;

  v_balance := v_balance + p_delta;

  update public.credit_wallets
     set balance = v_balance,
         lifetime_granted = lifetime_granted + greatest(p_delta, 0),
         lifetime_spent = lifetime_spent + greatest(-p_delta, 0),
         updated_at = now()
   where tenant_id = p_tenant_id;

  insert into public.credit_ledger
    (tenant_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key, actor)
  values
    (p_tenant_id, p_delta, v_balance, p_reason, p_ref_type, p_ref_id, p_idempotency_key, p_actor);

  return query select true, v_balance, 'ok'::text;
end;
$$;

revoke all on function public.credits_move_v1(text, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.credits_move_v1(text, integer, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Páginas
-- ---------------------------------------------------------------------------

create table if not exists public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  /**
   * Endereço público no domínio da plataforma (`<slug>.dominio`). Único no
   * sistema inteiro, não por tenant — é um hostname real.
   */
  slug text not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  /** Regra de distribuição que admite o lead. Sem ela a página capta e não entrega. */
  rule_id uuid null references public.lead_distribution_rules(id) on delete set null,
  funnel_id text null,
  column_id text null,
  published_version_id uuid null,
  draft_version_id uuid null,
  primary_domain_id uuid null,
  /** Herdado pela submissão, para o recorte por equipe valer desde a entrada. */
  team_id uuid null,
  archived_at timestamptz null,
  archived_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

create index if not exists landing_pages_tenant_idx
  on public.landing_pages (tenant_id, created_at desc);
create index if not exists landing_pages_status_idx
  on public.landing_pages (tenant_id, status);

/**
 * Versões imutáveis. Publicar é apontar `published_version_id` para uma delas —
 * então voltar atrás é trocar um ponteiro, nunca regerar com IA (que custaria
 * crédito de novo e daria texto diferente).
 */
create table if not exists public.landing_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.landing_pages(id) on delete cascade,
  tenant_id text not null,
  version_no integer not null,
  blocks jsonb not null default '[]'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  form_fields jsonb not null default '[]'::jsonb,
  /** Rótulo do teste A/B. Null = versão única. */
  variant_label text null,
  generated_by text not null default 'manual'
    check (generated_by in ('manual', 'ai', 'template', 'restore')),
  credits_spent integer not null default 0 check (credits_spent >= 0),
  created_by text null,
  created_at timestamptz not null default now(),
  unique (page_id, version_no)
);

create index if not exists landing_page_versions_page_idx
  on public.landing_page_versions (page_id, version_no desc);

-- ---------------------------------------------------------------------------
-- 3. Domínios
-- ---------------------------------------------------------------------------
-- Três origens: subdomínio da plataforma (grátis, imediato), domínio que o
-- cliente já tem (aponta o DNS) e domínio comprado por nós (compramos e
-- apontamos sozinhos).
--
-- `host` é único no sistema inteiro: dois tenants não podem reivindicar o mesmo
-- endereço, e quem chegou primeiro e provou posse fica com ele.

create table if not exists public.landing_page_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  page_id uuid null references public.landing_pages(id) on delete set null,
  host text not null,
  source text not null default 'byo'
    check (source in ('platform_subdomain', 'byo', 'purchased')),
  status text not null default 'pending_dns'
    check (status in ('pending_dns', 'verifying', 'active', 'failed', 'removed')),
  /**
   * Prova de posse. Vai num TXT em `_mychatcrm.<host>`: sem isto qualquer
   * cliente reivindicaria o domínio de um concorrente e roubaria o tráfego.
   */
  verification_token text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at timestamptz null,
  dns_target text null,
  ssl_status text not null default 'pending'
    check (ssl_status in ('pending', 'active', 'failed')),
  /** Referência do registador quando fomos nós que compramos. */
  provider text null,
  provider_ref text null,
  purchase_expires_at timestamptz null,
  last_checked_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (host)
);

create index if not exists landing_page_domains_tenant_idx
  on public.landing_page_domains (tenant_id, created_at desc);
create index if not exists landing_page_domains_page_idx
  on public.landing_page_domains (page_id);
create index if not exists landing_page_domains_active_idx
  on public.landing_page_domains (host) where status = 'active';

-- ---------------------------------------------------------------------------
-- 4. Submissões
-- ---------------------------------------------------------------------------

create table if not exists public.landing_page_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  page_id uuid not null references public.landing_pages(id) on delete cascade,
  version_id uuid null references public.landing_page_versions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  /**
   * gclid / wbraid / gbraid / fbclid / utm_*. Guardado desde já mesmo sem a
   * importação de conversões ligada: o clique só passa uma vez, e reconstruir
   * atribuição depois é impossível.
   */
  attribution jsonb not null default '{}'::jsonb,
  lead_id uuid null references public.leads(id) on delete set null,
  lead_status text not null default 'pending'
    check (lead_status in ('pending', 'created', 'updated', 'blocked', 'failed', 'duplicate')),
  lead_error text null,
  /** Hash, nunca o IP: a auditoria do projeto é PII-free por regra. */
  ip_hash text null,
  user_agent text null,
  /** Mesma pessoa, mesmo formulário, dois cliques no botão = uma submissão. */
  dedup_key text not null,
  created_at timestamptz not null default now(),
  unique (page_id, dedup_key)
);

create index if not exists landing_page_submissions_tenant_idx
  on public.landing_page_submissions (tenant_id, created_at desc);
create index if not exists landing_page_submissions_page_idx
  on public.landing_page_submissions (page_id, created_at desc);
create index if not exists landing_page_submissions_lead_idx
  on public.landing_page_submissions (lead_id);

-- Chaves estrangeiras tardias (as tabelas referenciadas nascem acima).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'landing_pages_published_version_fk'
  ) then
    alter table public.landing_pages
      add constraint landing_pages_published_version_fk
      foreign key (published_version_id)
      references public.landing_page_versions(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'landing_pages_draft_version_fk'
  ) then
    alter table public.landing_pages
      add constraint landing_pages_draft_version_fk
      foreign key (draft_version_id)
      references public.landing_page_versions(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'landing_pages_primary_domain_fk'
  ) then
    alter table public.landing_pages
      add constraint landing_pages_primary_domain_fk
      foreign key (primary_domain_id)
      references public.landing_page_domains(id) on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Atribuição no lead
-- ---------------------------------------------------------------------------
-- A tabela `leads` nasceu do WhatsApp e nunca teve de onde o lead veio, além do
-- texto livre em `source`. Sem isto não há como devolver conversão ao Google.

alter table public.leads add column if not exists attribution jsonb null;
alter table public.leads add column if not exists landing_page_id uuid null;

create index if not exists leads_landing_page_idx
  on public.leads (tenant_id, landing_page_id)
  where landing_page_id is not null;

-- ---------------------------------------------------------------------------
-- 6. Segurança
-- ---------------------------------------------------------------------------
-- O renderizador público lê pela service role no servidor; `anon` nunca toca
-- nestas tabelas. Formulário publicado não pode virar porta de leitura do
-- banco — foi assim que o furo da Central apareceu (middleware não guarda /api).

alter table public.landing_pages enable row level security;
alter table public.landing_page_versions enable row level security;
alter table public.landing_page_domains enable row level security;
alter table public.landing_page_submissions enable row level security;

revoke all on public.landing_pages from public, anon, authenticated;
revoke all on public.landing_page_versions from public, anon, authenticated;
revoke all on public.landing_page_domains from public, anon, authenticated;
revoke all on public.landing_page_submissions from public, anon, authenticated;

grant select, insert, update, delete on public.landing_pages to service_role;
grant select, insert, update, delete on public.landing_page_versions to service_role;
grant select, insert, update, delete on public.landing_page_domains to service_role;
grant select, insert, update, delete on public.landing_page_submissions to service_role;

-- ---------------------------------------------------------------------------
-- 7. Página extra como addon
-- ---------------------------------------------------------------------------
-- Reaproveita o catálogo de addons que já existe em vez de inventar um segundo
-- sistema de cobrança. `landing_page` entra na mesma lista de `kind` que
-- `lead_capacity` e `whatsapp_line`, e o resto da máquina (checkout, webhook,
-- entitlements) funciona sem alteração.

alter table public.billing_addon_catalog
  drop constraint if exists billing_addon_catalog_kind_check;
alter table public.billing_addon_catalog
  add constraint billing_addon_catalog_kind_check
  check (kind in ('lead_capacity', 'whatsapp_line', 'api_connector', 'landing_page'));

alter table public.tenant_billing_entitlements
  drop constraint if exists tenant_billing_entitlements_kind_check;
alter table public.tenant_billing_entitlements
  add constraint tenant_billing_entitlements_kind_check
  check (kind in ('lead_capacity', 'whatsapp_line', 'api_connector', 'landing_page'));

insert into public.billing_addon_catalog (
  code, title, description, kind, billing_mode, included_quantity,
  currency, amount_cents, interval_unit, active, metadata
) values (
  'landing_page_extra',
  'Página de captura adicional',
  'Uma página publicada além das incluídas no plano.',
  'landing_page',
  'recurring',
  1,
  'brl',
  3990,
  'month',
  true,
  '{}'::jsonb
)
on conflict (code) do nothing;
