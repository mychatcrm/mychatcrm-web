"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type { AdminSession } from "@/lib/admin-auth";
import { getAdminDataset, type AdminClientRow, type AdminDataset, type AdminRouteKey } from "@/lib/admin-data";
import { WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL } from "@/lib/plans";
import { cn, formatBRL } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { AdminCouponsWorkspace } from "@/components/admin/commercial/AdminCouponsWorkspace";
import { AdminPartnersHub } from "@/components/admin/commercial/AdminPartnersHub";
import { MaintenanceModePanel } from "@/components/admin/MaintenanceModePanel";
import { AdminEnterpriseWorkspace } from "@/components/admin/enterprise/AdminEnterpriseWorkspace";

const PlatformIntelligenceDashboard = dynamic(
  () =>
    import("@/components/admin/platform/PlatformIntelligenceDashboard").then((m) => ({
      default: m.PlatformIntelligenceDashboard,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className={cn(
          "flex min-h-[280px] items-center justify-center rounded-xl border border-line",
          "bg-surface-card/80 text-sm text-content-muted",
        )}
      >
        A carregar inteligência da plataforma…
      </div>
    ),
  },
);

function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-content sm:text-xl">{title}</h2>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-card p-4">
      <p className="text-sm text-content-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-content">{value}</p>
      <p className="mt-2 text-xs text-content-faint">{helper}</p>
    </div>
  );
}

function Bars({ items }: { items: { label: string; value: number; color?: string }[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-content-secondary">{item.label}</span>
            <span className="text-content-faint">{item.value}%</span>
          </div>
          <div className="h-3 rounded-full bg-line/40">
            <div className={cn("h-3 rounded-full bg-primary", item.color)} style={{ width: `${item.value}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsPage({ dataset }: { dataset: ReturnType<typeof getAdminDataset> }) {
  return (
    <div className="space-y-6">
      <Panel title="Filtros e visao analitica" actions={<Select defaultValue="30d"><option value="7d">7 dias</option><option value="30d">30 dias</option><option value="90d">90 dias</option><option value="12m">12 meses</option></Select>}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {dataset.analyticsStats.map((item) => (
            <Stat key={item.label} {...item} />
          ))}
        </div>
      </Panel>
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Aquisicao"><Bars items={dataset.acquisitionBars} /></Panel>
        <Panel title="Retencao"><Bars items={dataset.retentionBars} /></Panel>
        <Panel title="Receita"><Bars items={dataset.revenueBars} /></Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Performance de Agentes">
          <div className="space-y-3">
            {dataset.topAgents.map((agent) => (
              <div key={agent.nome} className="flex items-center justify-between rounded-xl border border-line bg-surface-card p-3 text-sm">
                <div>
                  <p className="font-medium text-content">{agent.nome}</p>
                  <p className="text-xs text-content-faint">
                    {agent.cliente} · origem principal: {agent.origemPrincipal}
                  </p>
                </div>
                <Badge className="border-primary/30 bg-primary/10 text-primary">{agent.conversasDia} conv/dia</Badge>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Adoção de multiagentes">
          <div className="space-y-4">
            <div>
              <p className={cn(typography.ui.overline, "text-content-faint")}>Distribuição por cliente</p>
              <ul className="mt-2 space-y-2 text-sm text-content-secondary">
                {dataset.agentDistribution.map((item) => (
                  <li key={item.faixa} className="flex items-center justify-between">
                    <span>{item.faixa}</span>
                    <span>{item.totalClientes} clientes</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className={cn(typography.ui.overline, "text-content-faint")}>Origem mais usada</p>
              <ul className="mt-2 space-y-2 text-sm text-content-secondary">
                {dataset.agentOriginShare.map((item) => (
                  <li key={item.origem} className="flex items-center justify-between">
                    <span>{item.origem}</span>
                    <span>{item.percentual}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Conversas por agente por dia">
        <div className="space-y-3">
          {dataset.agentConversationsDaily.map((row) => (
            <div key={row.dia} className="rounded-xl border border-line bg-surface-card p-3">
              <div className="mb-2 flex items-center justify-between text-sm text-content-secondary">
                <span>{row.dia}</span>
                <span>{row.mariana + row.carlos + row.verao} total</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.min(100, row.mariana)}%` }} />
                <div className="h-2 rounded-full bg-primary-hover/85" style={{ width: `${Math.min(100, row.carlos)}%` }} />
                <div className="h-2 rounded-full bg-amber-500/80" style={{ width: `${Math.min(100, row.verao)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ClientsPage({ dataset }: { dataset: ReturnType<typeof getAdminDataset> }) {
  const [active, setActive] = useState<AdminClientRow | null>(null);
  const columns: Column<AdminClientRow>[] = [
    { key: "nome", header: "Cliente", render: (row) => row.nome },
    { key: "empresa", header: "Empresa", render: (row) => row.empresa },
    { key: "plano", header: "Plano", render: (row) => row.plano },
    { key: "status", header: "Status", render: (row) => row.status },
    { key: "mrr", header: "MRR", render: (row) => formatBRL(row.mrr) },
    { key: "ultimo", header: "Ultimo acesso", render: (row) => row.ultimoAcesso },
    { key: "saude", header: "Saude", render: (row) => `${row.saude}/100` },
  ];

  return (
    <div className="space-y-6">
      <Panel title="Base completa de clientes" description="Visao master com saude, uso, assinaturas e acoes administrativas.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input placeholder="Buscar nome, email, empresa ou telefone" />
          <Select defaultValue="todos">
            <option value="todos">Todos os planos</option>
            <option value="solo">Solo</option>
            <option value="equipa">Equipa</option>
            <option value="escala">Escala</option>
            <option value="enterprise">Enterprise</option>
          </Select>
          <Select defaultValue="todos"><option value="todos">Todos os status</option><option value="ativo">Ativo</option><option value="inadimplente">Inadimplente</option><option value="cancelado">Cancelado</option></Select>
          <Select defaultValue="todos"><option value="todos">Saude geral</option><option value="saudavel">Saudavel</option><option value="risco">Em risco</option><option value="critico">Critico</option></Select>
          <Button variant="secondary">Exportar CSV</Button>
        </div>
      </Panel>
      <Panel title="Tabela master">
        <DataTable columns={columns} data={dataset.clients} rowKey={(row) => row.id} onRowClick={setActive} />
      </Panel>
      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.nome ?? "Cliente"}
        className="max-w-4xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setActive(null)}>Fechar</Button>
            <Button>Impersonar cliente</Button>
          </>
        }
      >
        {active ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-surface-deep p-4 text-sm text-content-secondary">
                <p>Plano: {active.plano}</p>
                <p>MRR: {formatBRL(active.mrr)}</p>
                <p>Saude: {active.saude}/100</p>
                <p>Uso de leads: {active.monthlyLeadUsagePct}% da cota mensal</p>
              </div>
              <div className="rounded-xl border border-line bg-surface-deep p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">Acoes Admin</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Button variant="secondary">Trocar plano</Button>
                  <Button variant="secondary">Aplicar desconto</Button>
                  <Button variant="secondary">Aumentar limite de leads</Button>
                  <Button variant="secondary">Resetar senha</Button>
                  <Button variant="secondary">Adicionar nota</Button>
                  <Button variant="danger">Suspender conta</Button>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-surface-deep p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">Financeiro</p>
                <ul className="mt-2 space-y-2">
                  <li>Fatura Abril · paga</li>
                  <li>Fatura Maio · pendente</li>
                  <li>Cartao cadastrado · final 4242</li>
                </ul>
              </div>
              <div className="rounded-xl border border-line bg-surface-deep p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">Suporte e logs</p>
                <ul className="mt-2 space-y-2">
                  <li>2 tickets abertos</li>
                  <li>Ultimo login hoje as 09:42</li>
                  <li>Erro mais recente: falha webhook Gmail</li>
                </ul>
              </div>
              <div className="rounded-xl border border-line bg-surface-deep p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">Agentes configurados</p>
                <p className="mt-1">
                  {active.agentesAtivos} de {active.limiteAgentes} agentes ativos no plano
                </p>
                <ul className="mt-2 space-y-2">
                  {active.agentesMaisAtivos.map((agent) => (
                    <li key={agent}>{agent}</li>
                  ))}
                </ul>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Button variant="secondary" size="sm">
                    Ver configuração do agente
                  </Button>
                  <Button size="sm">Aumentar limite de agentes</Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function PlansPage() {
  return (
    <div className="space-y-6">
      <Panel
        title="Planos e limites de multiagentes"
        description={`Defina capacidades por plano para agentes. WhatsApp: 1 número API oficial em todos os planos; cada número adicional +${formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês.`}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface-card p-4">
            <p className="text-sm font-semibold text-content">Plano Profissional</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Input type="number" defaultValue={3} placeholder="Limite de agentes simultâneos" />
              <Input type="number" defaultValue={3} placeholder="Limite de follow-ups por lead" />
              <Input type="number" defaultValue={5} placeholder="Limite de keywords por agente" />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <Toggle id="prof-lead-ads" checked onChange={() => undefined} label="Pode usar Lead Ads?" />
              <Toggle id="prof-ctw" checked={false} onChange={() => undefined} label="Pode usar Click to WhatsApp?" />
              <Toggle id="prof-qr" checked={false} onChange={() => undefined} label="Pode gerar QR Codes?" />
              <Toggle id="prof-follow" checked onChange={() => undefined} label="Pode usar follow-up automático?" />
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-card p-4">
            <p className="text-sm font-semibold text-content">Plano Master</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Input type="number" defaultValue={30} placeholder="Limite de agentes simultâneos" />
              <Input type="number" defaultValue={8} placeholder="Limite de follow-ups por lead" />
              <Input type="number" defaultValue={40} placeholder="Limite de keywords por agente" />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <Toggle id="master-lead-ads" checked onChange={() => undefined} label="Pode usar Lead Ads?" />
              <Toggle id="master-ctw" checked onChange={() => undefined} label="Pode usar Click to WhatsApp?" />
              <Toggle id="master-qr" checked onChange={() => undefined} label="Pode gerar QR Codes?" />
              <Toggle id="master-follow" checked onChange={() => undefined} label="Pode usar follow-up automático?" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button>Salvar limites de planos</Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SimpleListPage({
  title,
  description,
  items,
  action,
}: {
  title: string;
  description: string;
  items: string[];
  action?: string;
}) {
  return (
    <Panel title={title} description={description} actions={action ? <Button>{action}</Button> : null}>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item} className="rounded-xl border border-line bg-surface-card p-4 text-sm text-content-secondary">
            {item}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FinancePage() {
  return (
    <div className="space-y-6">
      <Panel title="Receita e projecao">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Stat label="Receita bruta" value="R$ 156.220" helper="+6,9% vs mes anterior" />
          <Stat label="Receita liquida" value="R$ 141.870" helper="Descontos e taxas aplicadas" />
          <Stat label="MRR" value="R$ 128.430" helper="Base recorrente" />
          <Stat label="Churn de receita" value="R$ 8.120" helper="Mes atual" />
        </div>
      </Panel>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Breakdown por plano"><Bars items={[{ label: "Master", value: 58 }, { label: "Profissional", value: 34 }, { label: "Trial", value: 8 }]} /></Panel>
        <Panel title="Projecao 6 meses"><Bars items={[{ label: "Mai", value: 68 }, { label: "Jun", value: 72 }, { label: "Jul", value: 75 }, { label: "Ago", value: 79 }]} /></Panel>
      </div>
    </div>
  );
}

function ConfigPage() {
  const { isLight } = usePanelAppearance();
  const tabs = ["Empresa", "IA & Chatbot", "WhatsApp", "Pagamentos", "Email", "Integracoes Externas", "Armazenamento", "SEO & Analytics", "Manutencao"];
  const [tab, setTab] = useState(tabs[0]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "min-h-[44px] rounded-xl border px-4 text-sm",
              tab === item
                ? isLight
                  ? "border-primary/30 bg-primary/[0.1] text-content"
                  : "border-primary/35 bg-primary/15 text-content"
                : "border-line bg-surface-elevated/50 text-content-secondary",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      <Panel title={tab}>
        <div className="grid gap-4 md:grid-cols-2">
          <Input placeholder="Nome ou identificador" />
          <Input placeholder="Valor principal" />
          <Input placeholder="Opcional 1" />
          <Input placeholder="Opcional 2" />
          <div className="md:col-span-2">
            <Toggle id="admin-toggle" checked onChange={() => undefined} label="Ativo" description="Configuracao mockada para demonstracao visual." />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function TeamPage({ dataset }: { dataset: ReturnType<typeof getAdminDataset> }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
      <SimpleListPage
        title="Colaboradores"
        description="Roles, status de acesso e ultimas atividades."
        items={dataset.teamMembers}
      />
      <Panel title="Convidar colaborador">
        <div className="space-y-3">
          <Input placeholder="Nome" />
          <Input placeholder="Email" />
          <Select defaultValue="admin">
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="financeiro">Financeiro</option>
            <option value="suporte">Suporte</option>
            <option value="marketing">Marketing</option>
            <option value="desenvolvedor">Desenvolvedor</option>
          </Select>
          <Button>Enviar convite</Button>
        </div>
      </Panel>
    </div>
  );
}

function SecurityPage({ dataset }: { dataset: ReturnType<typeof getAdminDataset> }) {
  return (
    <div className="space-y-6">
      <MaintenanceModePanel />
      <div className="grid gap-6 xl:grid-cols-2">
        <SimpleListPage
          title="Sessoes admin ativas"
          description="Dispositivos, IPs e ultimo acesso."
          items={dataset.securitySessions}
        />
        <Panel title="Politicas e bloqueios">
          <div className="space-y-3">
            <Toggle
              id="whitelist"
              checked={false}
              onChange={() => undefined}
              label="Whitelist de IP"
              description="Ative para restringir acesso ao /admin."
            />
            <Toggle id="schedule" checked={false} onChange={() => undefined} label="Bloquear fora do horario comercial" />
            <Toggle id="totp" checked={false} onChange={() => undefined} label="2FA para admin (futuro)" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function AdminWorkspace({
  routeKey,
  session,
  serverDataset,
}: {
  routeKey: AdminRouteKey;
  session: AdminSession;
  serverDataset?: AdminDataset;
}) {
  const { isLight } = usePanelAppearance();
  const computedDataset = useMemo(() => getAdminDataset(session), [session]);
  const dataset = serverDataset ?? computedDataset;
  const content = useMemo(() => {
    switch (routeKey) {
      case "dashboard":
        return <PlatformIntelligenceDashboard session={session} />;
      case "analytics":
        return <AnalyticsPage dataset={dataset} />;
      case "clientes":
        return <ClientsPage dataset={dataset} />;
      case "leads":
        return (
          <SimpleListPage
            title="Leads captados pelo chatbot"
            description="Origem, responsavel e conversao em cliente."
            action="Exportar CSV"
            items={[
              "Marina Costa · landing page · novo · responsavel Ana",
              "Fabio Nunes · /planos · qualificado · responsavel Renato",
              "Isabela Duarte · landing page · convertido · responsavel Camila",
            ]}
          />
        );
      case "inadimplentes":
        return (
          <SimpleListPage
            title="Clientes inadimplentes"
            description="Fluxo de cobranca, automacoes D+1/D+3/D+7 e negociacoes."
            items={[
              "Rios Auto Center · 4 dias em atraso · R$ 269,90",
              "Studio Vitta · 9 dias em atraso · R$ 369,90",
            ]}
          />
        );
      case "cancelamentos":
        return (
          <SimpleListPage
            title="Cancelamentos"
            description="Motivos, MRR perdido e acoes de retencao."
            items={[
              "Clinica Essencial · motivo: custo · MRR perdido R$ 269,90",
              "Atelie Rosa · motivo: baixa adocao · MRR perdido R$ 369,90",
            ]}
          />
        );
      case "planos":
        return <PlansPage />;
      case "enterprise":
        return <AdminEnterpriseWorkspace />;
      case "cupons":
        return <AdminCouponsWorkspace />;
      case "parcerias":
        return <AdminPartnersHub />;
      case "features":
        return (
          <SimpleListPage
            title="Feature flags"
            description="Ative recursos por plano ou por cliente especifico."
            items={[
              "Disparos em massa · Master ativo · Profissional inativo",
              "Respostas em audio · Master ativo · override para cliente Bella Estetica",
            ]}
          />
        );
      case "financeiro":
        return <FinancePage />;
      case "faturas":
        return (
          <SimpleListPage
            title="Faturas"
            description="Todas as cobrancas geradas, status e emissao de nota."
            action="Gerar fatura manual"
            items={[
              "Odonto Prime · Abril/2026 · paga · R$ 369,90",
              "Rios Auto Center · Abril/2026 · atrasada · R$ 269,90",
            ]}
          />
        );
      case "pagamentos":
        return (
          <SimpleListPage
            title="Eventos de pagamento"
            description="Feed em tempo real com sucesso, falha, disputa e reembolso."
            items={[
              "Pagamento confirmado · Odonto Prime · agora",
              "Falha por limite excedido · Rios Auto Center · 08:22",
              "Reembolso parcial · Studio Vitta · ontem",
            ]}
          />
        );
      case "churn":
        return (
          <SimpleListPage
            title="Analise de churn"
            description="Churn mensal, clientes em risco e motivos mais comuns."
            items={[
              "Churn mensal 2,8% · maior impacto no plano Profissional",
              "Top risco: Rios Auto Center, Studio Vitta, Atelie Rosa",
            ]}
          />
        );
      case "suporte":
        return (
          <SimpleListPage
            title="Central de suporte"
            description="Tickets, SLA, prioridade e templates de resposta."
            items={[
              "#TCK-1442 · Tecnico · alta · 3h aberto",
              "#TCK-1437 · Financeiro · media · 19h aberto",
              "#TCK-1430 · Comercial · baixa · resolvido",
            ]}
          />
        );
      case "comunicados":
        return (
          <SimpleListPage
            title="Comunicados"
            description="Banner no dashboard do cliente, email e agenda de manutencao."
            action="Criar comunicado"
            items={[
              "Atualizacao de plataforma · todos · email + banner",
              "Manutencao programada · Master · banner",
            ]}
          />
        );
      case "notificacoes":
        return (
          <SimpleListPage
            title="Templates de notificacoes"
            description="Sequencias para clientes e alertas internos da equipe."
            items={[
              "Boas-vindas D+0 · email · ativo",
              "Renovacao D-3 · email/WhatsApp · ativo",
              "Ticket urgente aberto · interno · ativo",
            ]}
          />
        );
      case "configuracoes":
        return <ConfigPage />;
      case "equipe":
        return <TeamPage dataset={dataset} />;
      case "apis":
        return (
          <SimpleListPage
            title="APIs e webhooks"
            description="Chaves, eventos, quotas e documentacao interna."
            action="Gerar API Key"
            items={[
              "Webhook novo_cliente · 200 OK · ultimo disparo ha 8 min",
              "API key Integrador ERP · write clientes/pagamentos · ativa",
            ]}
          />
        );
      case "logs":
        return (
          <SimpleListPage
            title="Logs do sistema"
            description="Acesso, acoes, erros, pagamentos e chamadas de IA."
            action="Exportar CSV"
            items={[
              "ERROR · webhook_failure · /api/chat · 10:14",
              "WARN · many_login_attempts · admin/login · 09:08",
              "INFO · payment_confirmed · cliente Odonto Prime · 08:52",
            ]}
          />
        );
      case "seguranca":
        return <SecurityPage dataset={dataset} />;
      default:
        return <PlatformIntelligenceDashboard session={session} />;
    }
  }, [routeKey, dataset, session]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          className={cn(
            isLight ? "border-primary/30 bg-primary/[0.1] text-content" : "border-primary/30 bg-primary/10 text-content",
          )}
        >
          {session.roleLabel}
        </Badge>
        <span className="text-sm text-content-muted">Sessao ativa para {session.displayName}</span>
      </div>
      {content}
    </div>
  );
}
