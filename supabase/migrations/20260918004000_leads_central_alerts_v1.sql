-- Central de Leads — Fase 5 (alertas de campanha)
--
-- Quem gasta em anúncio descobre tarde que algo parou: o formulário quebrou, a
-- campanha perdeu entrega, a integração caiu. Estes alertas viram um aviso na
-- Central em vez de uma descoberta no fim do mês.
--
-- A detecção compara o período recente com o período imediatamente anterior, do
-- mesmo tamanho — nada de metas fixas, que não servem a clientes de tamanhos
-- diferentes.

create table if not exists public.meta_lead_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  kind text not null
    check (kind in ('volume_drop', 'form_silent', 'error_spike', 'no_agent_spike')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  scope_type text not null default 'campaign' check (scope_type in ('campaign', 'form', 'page', 'tenant')),
  scope_id text null,
  scope_name text null,
  title text not null,
  detail text not null,
  /** Números que sustentam o alerta, para a interface não ter de recalcular. */
  metrics jsonb not null default '{}'::jsonb,
  /** Assinatura do alerta: o mesmo problema não vira dez avisos iguais. */
  fingerprint text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz null,
  acknowledged_by text null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (tenant_id, fingerprint)
);

create index if not exists meta_lead_alerts_tenant_open_idx
  on public.meta_lead_alerts (tenant_id, detected_at desc)
  where status = 'open';

alter table public.meta_lead_alerts enable row level security;
revoke all on public.meta_lead_alerts from public, anon, authenticated;
grant select, insert, update, delete on public.meta_lead_alerts to service_role;
