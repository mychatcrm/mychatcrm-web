-- Qual plano a pessoa tentou assinar antes de cair na lista de espera, e em
-- que ciclo. Sem isto não dá para saber de onde vem a procura.
alter table public.pre_launch_leads
  add column if not exists plan_slug text
    check (plan_slug is null or plan_slug in ('solo', 'equipa', 'escala', 'enterprise')),
  add column if not exists billing_cycle text
    check (billing_cycle is null or billing_cycle in ('monthly', 'annual'));

create index if not exists pre_launch_leads_plan_slug_idx
  on public.pre_launch_leads (plan_slug);
create index if not exists pre_launch_leads_billing_cycle_idx
  on public.pre_launch_leads (billing_cycle);

comment on column public.pre_launch_leads.plan_slug is
  'Plano que a pessoa clicou antes de ver a lista de espera. Null nos leads antigos, capturados pelo popup.';
comment on column public.pre_launch_leads.billing_cycle is
  'Ciclo escolhido na vitrine (mensal ou anual) no momento do clique.';
