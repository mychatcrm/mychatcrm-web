-- Funis do CRM no servidor.
--
-- Até aqui os funis viviam apenas no localStorage do navegador
-- (`mychatcrm-crm-funnels-v1`): os funis criados pelo titular existiam só na
-- máquina dele, um vendedor entrando de outro computador via os padrões, e
-- limpar o navegador apagava a configuração. Como `leads.crm_funnel_id`
-- referencia esses ids, não havia como o servidor sequer saber quais funis
-- existem — muito menos decidir quem pode ver cada um.
--
-- Esta migration cria o registro por tenant. A Fase 2 usa `crm_funnel_access`
-- para liberar funis por vendedor.

create table if not exists public.crm_funnels (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  -- Id lógico usado por `leads.crm_funnel_id` e pela configuração dos agentes
  -- (ex.: 'funil-default'). Mantido como texto para preservar os dados que já
  -- existem nos leads e nos agentes.
  funnel_id text not null,
  nome text not null,
  columns jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, funnel_id)
);

create index if not exists crm_funnels_tenant_position_idx
  on public.crm_funnels (tenant_id, position, funnel_id);

alter table public.crm_funnels enable row level security;

drop policy if exists "tenant_isolation" on public.crm_funnels;
create policy "tenant_isolation" on public.crm_funnels
  using (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update, delete on table public.crm_funnels to service_role;

comment on table public.crm_funnels is
  'Funis do CRM por tenant. Fonte de verdade a partir de 04/08/2026 — antes disso viviam apenas no localStorage do navegador de quem os criou.';
comment on column public.crm_funnels.funnel_id is
  'Id lógico referenciado por leads.crm_funnel_id e pela config de destino CRM dos agentes. Texto (não uuid) para preservar os ids já gravados.';
