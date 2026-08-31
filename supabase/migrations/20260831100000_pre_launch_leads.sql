-- Popup "site em fase final de testes" nos botões de contato/compra do site
-- público: config de liga/desliga (flag único) + captura de lead.

create table public.platform_launch_config (
  id text primary key default 'global',
  pre_launch_popup_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.platform_launch_config (id) values ('global')
  on conflict (id) do nothing;

create table public.pre_launch_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 1 and 200),
  whatsapp text not null check (char_length(whatsapp) between 8 and 20),
  email text not null check (char_length(email) between 3 and 200),
  business_description text not null check (char_length(business_description) between 1 and 500),
  ddd text,
  -- de onde veio o clique: "contact" (whatsapp/e-mail) ou "buy" (plano) — só pra referência do Renato.
  source text check (source is null or source in ('contact', 'buy')),
  created_at timestamptz not null default now()
);
create index on public.pre_launch_leads (created_at desc);
create index on public.pre_launch_leads (ddd);

alter table public.platform_launch_config enable row level security;
alter table public.pre_launch_leads enable row level security;

revoke all on table public.platform_launch_config from anon, authenticated;
revoke all on table public.pre_launch_leads from anon, authenticated;

grant select, insert, update on table public.platform_launch_config to service_role;
grant select, insert, update on table public.pre_launch_leads to service_role;

comment on table public.platform_launch_config is
  'Flag único (liga/desliga) do popup de pré-lançamento no site público. Pra desligar: PATCH /api/admin/platform-launch-config {"enabled":false}, ou o toggle em /admin/leads-lancamento.';
comment on table public.pre_launch_leads is
  'Contatos capturados pelo popup de pré-lançamento (visitante clicou em WhatsApp/comprar antes do produto estar pronto). Visível em /admin/leads-lancamento.';
