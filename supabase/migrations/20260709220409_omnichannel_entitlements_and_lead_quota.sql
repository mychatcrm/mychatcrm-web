-- Durable billing add-ons and transactional lead admission.
--
-- These tables are deliberately service-role only. Browser clients consume a
-- tenant-scoped snapshot through authenticated Next.js routes; they never get
-- access to Stripe identifiers, reservations, or another tenant's quota.

create table if not exists public.billing_addon_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text null,
  kind text not null check (kind in ('lead_capacity', 'whatsapp_line')),
  billing_mode text not null check (billing_mode in ('recurring', 'one_time')),
  included_quantity integer not null check (included_quantity > 0),
  stripe_product_id text null,
  stripe_price_id text null unique,
  currency text not null default 'brl',
  amount_cents integer null check (amount_cents is null or amount_cents >= 0),
  interval_unit text null check (interval_unit is null or interval_unit in ('month', 'year')),
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_addon_catalog_recurring_interval_check
    check ((billing_mode = 'recurring' and interval_unit is not null) or (billing_mode = 'one_time' and interval_unit is null))
);

-- Lead allowance is commercial configuration, not a browser calculation. Keeping
-- it in a small separate table lets Admin switch a plan between monthly and
-- annual cycles without changing legacy `admin_plan_config` contracts.
create table if not exists public.billing_plan_lead_policies (
  plan_slug text primary key,
  included_leads integer not null check (included_leads >= 0),
  periodicity text not null default 'monthly' check (periodicity in ('monthly', 'annual')),
  updated_at timestamptz not null default now(),
  updated_by text null
);

-- Safe drafts shown in Admin after the migration. They intentionally remain
-- inactive until an administrator binds each one to a real Stripe Price.
insert into public.billing_addon_catalog (
  code, title, description, kind, billing_mode, included_quantity, interval_unit, active
) values
  (
    'whatsapp_line_recurring',
    'Linha WhatsApp adicional',
    'Uma capacidade recorrente para conectar mais um número WhatsApp.',
    'whatsapp_line',
    'recurring',
    1,
    'month',
    false
  ),
  (
    'lead_capacity_recurring',
    'Capacidade mensal de leads',
    'Leads adicionais em cada ciclo comercial ativo.',
    'lead_capacity',
    'recurring',
    100,
    'month',
    false
  ),
  (
    'lead_capacity_topup',
    'Recarga avulsa de leads',
    'Leads adicionais válidos somente até o fim do ciclo atual.',
    'lead_capacity',
    'one_time',
    100,
    null,
    false
  )
on conflict (code) do nothing;

-- Enterprise provisions already own the tenant-specific numerical limits. This
-- additive flag only selects the commercial cycle used for its lead allowance.
alter table public.enterprise_provisions
  add column if not exists lead_quota_periodicity text not null default 'monthly'
  check (lead_quota_periodicity in ('monthly', 'annual'));

create table if not exists public.tenant_billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  addon_catalog_id uuid null references public.billing_addon_catalog(id) on delete set null,
  kind text not null check (kind in ('lead_capacity', 'whatsapp_line')),
  billing_mode text not null check (billing_mode in ('recurring', 'one_time')),
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'scheduled_cancel', 'cancelled', 'expired', 'revoked')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz null,
  stripe_checkout_session_id text null unique,
  stripe_subscription_id text null,
  stripe_subscription_item_id text null unique,
  stripe_invoice_id text null,
  source text not null default 'stripe' check (source in ('stripe', 'legacy_backfill', 'admin_grant')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_billing_entitlements_tenant_kind_active_idx
  on public.tenant_billing_entitlements (tenant_id, kind, status, valid_until);

create index if not exists tenant_billing_entitlements_stripe_subscription_idx
  on public.tenant_billing_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.tenant_lead_quota_cycles (
  tenant_id text not null,
  cycle_start date not null,
  cycle_end date not null,
  periodicity text not null check (periodicity in ('monthly', 'annual')),
  base_limit integer not null check (base_limit >= 0),
  recurring_bonus integer not null default 0 check (recurring_bonus >= 0),
  topup_bonus integer not null default 0 check (topup_bonus >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, cycle_start),
  constraint tenant_lead_quota_cycles_range_check check (cycle_end >= cycle_start)
);

create table if not exists public.tenant_lead_quota_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  cycle_start date not null,
  contact_key text not null,
  source text not null check (source in ('meta_form', 'whatsapp_campaign', 'crm_manual', 'whatsapp_direct')),
  idempotency_key text not null,
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  reservation_expires_at timestamptz null,
  lead_id uuid null references public.leads(id) on delete set null,
  journey_id uuid null references public.lead_journeys(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz null,
  released_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, cycle_start)
    references public.tenant_lead_quota_cycles (tenant_id, cycle_start)
    on delete cascade
);

create unique index if not exists tenant_lead_quota_one_active_contact_idx
  on public.tenant_lead_quota_events (tenant_id, cycle_start, contact_key)
  where status in ('reserved', 'committed');

create index if not exists tenant_lead_quota_events_reservation_expiry_idx
  on public.tenant_lead_quota_events (reservation_expires_at)
  where status = 'reserved';

create index if not exists tenant_lead_quota_events_tenant_cycle_idx
  on public.tenant_lead_quota_events (tenant_id, cycle_start, status);

-- Preserve paid QR/WhatsApp capacity that existed before the entitlement
-- ledger. This is intentionally one record per tenant and never touches a
-- Stripe subscription or a customer-facing counter.
insert into public.tenant_billing_entitlements (
  tenant_id,
  kind,
  billing_mode,
  quantity,
  status,
  source,
  metadata
)
select
  ss.tenant_id,
  'whatsapp_line',
  'recurring',
  greatest(1, ss.extra_whatsapp_slots),
  'active',
  'legacy_backfill',
  jsonb_build_object('legacy_extra_whatsapp_slots', ss.extra_whatsapp_slots)
from public.stripe_subscriptions ss
where coalesce(ss.extra_whatsapp_slots, 0) > 0
  and not exists (
    select 1
      from public.tenant_billing_entitlements entitlement
     where entitlement.tenant_id = ss.tenant_id
       and entitlement.kind = 'whatsapp_line'
       and entitlement.source = 'legacy_backfill'
  );

alter table public.billing_addon_catalog enable row level security;
alter table public.billing_plan_lead_policies enable row level security;
alter table public.tenant_billing_entitlements enable row level security;
alter table public.tenant_lead_quota_cycles enable row level security;
alter table public.tenant_lead_quota_events enable row level security;

revoke all on table public.billing_addon_catalog from anon, authenticated;
revoke all on table public.billing_plan_lead_policies from anon, authenticated;
revoke all on table public.tenant_billing_entitlements from anon, authenticated;
revoke all on table public.tenant_lead_quota_cycles from anon, authenticated;
revoke all on table public.tenant_lead_quota_events from anon, authenticated;

grant select, insert, update, delete on table public.billing_addon_catalog to service_role;
grant select, insert, update, delete on table public.billing_plan_lead_policies to service_role;
grant select, insert, update, delete on table public.tenant_billing_entitlements to service_role;
grant select, insert, update, delete on table public.tenant_lead_quota_cycles to service_role;
grant select, insert, update, delete on table public.tenant_lead_quota_events to service_role;

-- Reserves exactly one new contact in a tenant's commercial cycle. The function
-- locks by tenant/cycle and contact, expires stale reservations before checking
-- capacity, and treats a repeated idempotency key as the same admission.
create or replace function public.reserve_tenant_lead_quota(
  p_tenant_id text,
  p_cycle_start date,
  p_cycle_end date,
  p_periodicity text,
  p_base_limit integer,
  p_recurring_bonus integer,
  p_topup_bonus integer,
  p_contact_key text,
  p_source text,
  p_idempotency_key text,
  p_reservation_seconds integer default 300,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  admitted boolean,
  event_id uuid,
  status text,
  used_count integer,
  total_limit integer,
  remaining integer,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cycle public.tenant_lead_quota_cycles;
  v_event public.tenant_lead_quota_events;
  v_existing_contact public.tenant_lead_quota_events;
  v_total integer;
  v_legacy_used integer := 0;
  v_reservation_seconds integer := greatest(30, least(coalesce(p_reservation_seconds, 300), 3600));
begin
  if coalesce(trim(p_tenant_id), '') = ''
    or p_cycle_start is null
    or p_cycle_end is null
    or coalesce(trim(p_contact_key), '') = ''
    or coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'missing lead quota reservation identity';
  end if;
  if p_periodicity not in ('monthly', 'annual') then
    raise exception 'invalid quota periodicity';
  end if;
  if p_source not in ('meta_form', 'whatsapp_campaign', 'crm_manual', 'whatsapp_direct') then
    raise exception 'invalid quota source';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    trim(p_tenant_id) || ':' || p_cycle_start::text || ':' || trim(p_contact_key),
    0
  ));

  -- Free abandoned reservations before capacity is evaluated.
  with expired as (
    update public.tenant_lead_quota_events
       set status = 'released',
           released_at = now(),
           updated_at = now()
     where tenant_id = p_tenant_id
       and cycle_start = p_cycle_start
       and status = 'reserved'
       and reservation_expires_at < now()
     returning 1
  )
  update public.tenant_lead_quota_cycles
     set used_count = greatest(0, used_count - (select count(*) from expired)),
         updated_at = now()
   where tenant_id = p_tenant_id
     and cycle_start = p_cycle_start
     and exists (select 1 from expired);

  -- A plan edit or paid capacity purchase can happen during an open cycle.
  -- Refresh the commercial cap before every admission so the webhook's
  -- confirmed entitlement is usable immediately, without touching usage.
  update public.tenant_lead_quota_cycles
     set cycle_end = p_cycle_end,
         periodicity = p_periodicity,
         base_limit = greatest(0, coalesce(p_base_limit, 0)),
         recurring_bonus = greatest(0, coalesce(p_recurring_bonus, 0)),
         topup_bonus = greatest(0, coalesce(p_topup_bonus, 0)),
         updated_at = now()
   where tenant_id = p_tenant_id
     and cycle_start = p_cycle_start;

  select * into v_event
    from public.tenant_lead_quota_events
   where tenant_id = p_tenant_id
     and idempotency_key = p_idempotency_key
   limit 1;
  if found then
    select * into v_cycle
      from public.tenant_lead_quota_cycles
     where tenant_id = p_tenant_id and cycle_start = p_cycle_start
     for update;
    v_total := coalesce(v_cycle.base_limit, 0) + coalesce(v_cycle.recurring_bonus, 0) + coalesce(v_cycle.topup_bonus, 0);

    -- A retry after a failed CRM/transport operation must be allowed to reuse
    -- its same idempotency key. The reservation was released (and its usage
    -- was deducted) so it is safe to reserve it again when capacity remains.
    if v_event.status = 'released' then
      if coalesce(v_cycle.used_count, 0) >= v_total then
        return query select false, null::uuid, 'blocked', coalesce(v_cycle.used_count, 0), v_total, 0, 'lead_quota_exhausted';
        return;
      end if;

      update public.tenant_lead_quota_events
         set status = 'reserved',
             reservation_expires_at = now() + make_interval(secs => v_reservation_seconds),
             released_at = null,
             metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
             updated_at = now()
       where id = v_event.id
       returning * into v_event;

      update public.tenant_lead_quota_cycles
         set used_count = used_count + 1,
             updated_at = now()
       where tenant_id = p_tenant_id
         and cycle_start = p_cycle_start
       returning * into v_cycle;

      return query select true, v_event.id, 'reserved', v_cycle.used_count, v_total,
        greatest(0, v_total - v_cycle.used_count), 'reservation_reused';
      return;
    end if;

    return query select
      v_event.status in ('reserved', 'committed'),
      v_event.id,
      v_event.status,
      coalesce(v_cycle.used_count, 0),
      v_total,
      greatest(0, v_total - coalesce(v_cycle.used_count, 0)),
      'idempotent_replay';
    return;
  end if;

  select coalesce(used_count, 0) into v_legacy_used
    from public.tenant_lead_usage
   where tenant_id = p_tenant_id
     and cycle_month = p_cycle_start
   limit 1;

  insert into public.tenant_lead_quota_cycles (
    tenant_id, cycle_start, cycle_end, periodicity, base_limit,
    recurring_bonus, topup_bonus, used_count, updated_at
  ) values (
    p_tenant_id, p_cycle_start, p_cycle_end, p_periodicity,
    greatest(0, coalesce(p_base_limit, 0)),
    greatest(0, coalesce(p_recurring_bonus, 0)),
    greatest(0, coalesce(p_topup_bonus, 0)),
    greatest(0, v_legacy_used), now()
  )
  on conflict (tenant_id, cycle_start) do nothing;

  select * into v_cycle
    from public.tenant_lead_quota_cycles
   where tenant_id = p_tenant_id and cycle_start = p_cycle_start
   for update;
  v_total := v_cycle.base_limit + v_cycle.recurring_bonus + v_cycle.topup_bonus;

  select * into v_existing_contact
    from public.tenant_lead_quota_events
   where tenant_id = p_tenant_id
     and cycle_start = p_cycle_start
     and contact_key = p_contact_key
     and status in ('reserved', 'committed')
   limit 1;
  if found then
    return query select
      true,
      v_existing_contact.id,
      v_existing_contact.status,
      v_cycle.used_count,
      v_total,
      greatest(0, v_total - v_cycle.used_count),
      'contact_already_admitted';
    return;
  end if;

  if v_cycle.used_count >= v_total then
    return query select false, null::uuid, 'blocked', v_cycle.used_count, v_total, 0, 'lead_quota_exhausted';
    return;
  end if;

  insert into public.tenant_lead_quota_events (
    tenant_id, cycle_start, contact_key, source, idempotency_key, status,
    reservation_expires_at, metadata, updated_at
  ) values (
    p_tenant_id, p_cycle_start, p_contact_key, p_source, p_idempotency_key,
    'reserved', now() + make_interval(secs => v_reservation_seconds),
    coalesce(p_metadata, '{}'::jsonb), now()
  ) returning * into v_event;

  update public.tenant_lead_quota_cycles
     set used_count = used_count + 1,
         updated_at = now()
   where tenant_id = p_tenant_id
     and cycle_start = p_cycle_start
   returning * into v_cycle;

  return query select true, v_event.id, v_event.status, v_cycle.used_count, v_total,
    greatest(0, v_total - v_cycle.used_count), 'reserved';
end;
$$;

create or replace function public.commit_tenant_lead_quota_reservation(
  p_event_id uuid,
  p_lead_id uuid default null,
  p_journey_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.tenant_lead_quota_events;
begin
  select * into v_event from public.tenant_lead_quota_events where id = p_event_id for update;
  if not found then return false; end if;
  if v_event.status = 'committed' then return true; end if;
  if v_event.status <> 'reserved' or v_event.reservation_expires_at < now() then return false; end if;

  update public.tenant_lead_quota_events
     set status = 'committed',
         reservation_expires_at = null,
         lead_id = coalesce(p_lead_id, lead_id),
         journey_id = coalesce(p_journey_id, journey_id),
         committed_at = now(),
         updated_at = now()
   where id = p_event_id;
  return true;
end;
$$;

create or replace function public.release_tenant_lead_quota_reservation(
  p_event_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.tenant_lead_quota_events;
begin
  select * into v_event from public.tenant_lead_quota_events where id = p_event_id for update;
  if not found or v_event.status <> 'reserved' then return false; end if;

  update public.tenant_lead_quota_events
     set status = 'released',
         released_at = now(),
         reservation_expires_at = null,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('release_reason', p_reason),
         updated_at = now()
   where id = p_event_id;

  update public.tenant_lead_quota_cycles
     set used_count = greatest(0, used_count - 1),
         updated_at = now()
   where tenant_id = v_event.tenant_id
     and cycle_start = v_event.cycle_start;
  return true;
end;
$$;

revoke all on function public.reserve_tenant_lead_quota(text, date, date, text, integer, integer, integer, text, text, text, integer, jsonb) from public;
revoke all on function public.commit_tenant_lead_quota_reservation(uuid, uuid, uuid) from public;
revoke all on function public.release_tenant_lead_quota_reservation(uuid, text) from public;
grant execute on function public.reserve_tenant_lead_quota(text, date, date, text, integer, integer, integer, text, text, text, integer, jsonb) to service_role;
grant execute on function public.commit_tenant_lead_quota_reservation(uuid, uuid, uuid) to service_role;
grant execute on function public.release_tenant_lead_quota_reservation(uuid, text) to service_role;

comment on table public.billing_addon_catalog is
  'Admin-managed Stripe product and price mappings for recurring and one-time tenant add-ons.';
comment on table public.billing_plan_lead_policies is
  'Commercial lead allowance and monthly/annual periodicity for each public plan.';
comment on table public.tenant_billing_entitlements is
  'Idempotent tenant entitlements fulfilled from Stripe webhooks or a safe legacy backfill.';
comment on table public.tenant_lead_quota_events is
  'One record per distinct contact/cycle admission. Reservations make quota enforcement safe under concurrent webhooks.';
