"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Bot, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { AgentCreateOverlay, AgentManageOverlay } from "./AgentCreateOverlay";
import { SortableAgentCard } from "./SortableAgentCard";
import { listAgentsForTenant } from "@/lib/agents";
import type { Agent } from "@/lib/types";
import type { ClientSession } from "@/lib/client-auth";
import { EXTRA_AGENT_MONTHLY_BRL, getPlanIncludedAgentLimitForSession } from "@/lib/plan-limits";
import { formatBRL } from "@/lib/utils";
import { typography } from "@/lib/typography";

// ---------------------------------------------------------------------------
// Order persistence (localStorage — apenas ordenação visual)
// ---------------------------------------------------------------------------

function agentOrderStorageKey(tenantId: string) {
  return `mychatcrm:agent-order:${tenantId}`;
}

function applySavedAgentOrder(agents: Agent[], tenantId: string): Agent[] {
  if (typeof window === "undefined") return agents;
  try {
    const raw = localStorage.getItem(agentOrderStorageKey(tenantId));
    if (!raw) return agents;
    const order = JSON.parse(raw) as unknown;
    if (!Array.isArray(order) || !order.every((id) => typeof id === "string")) return agents;
    const byId = new Map(agents.map((a) => [a.id, a]));
    const ordered: Agent[] = [];
    for (const id of order) {
      const a = byId.get(id);
      if (a) {
        ordered.push(a);
        byId.delete(id);
      }
    }
    for (const a of agents) {
      if (byId.has(a.id)) ordered.push(a);
    }
    return ordered;
  } catch {
    return agents;
  }
}

function persistAgentOrder(agents: Agent[], tenantId: string) {
  try {
    localStorage.setItem(agentOrderStorageKey(tenantId), JSON.stringify(agents.map((a) => a.id)));
  } catch {
    /* ignore quota / private mode */
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiLoadAgents(): Promise<Agent[]> {
  const res = await fetch("/api/client/agentes", { cache: "no-store" });
  if (!res.ok) {
    console.warn("[agentes] GET non-OK", res.status);
    throw new Error(`GET /api/client/agentes ${res.status}`);
  }

  // O cast `as { agents: Agent[] }` que existia aqui era apenas hint de
  // TypeScript — não valida nada em runtime. Se a rota um dia mudasse de
  // shape (ex.: array direto, payload envelopado em `data`, ou um corpo
  // vazio por algum motivo), o componente lia `undefined`, caía no
  // fallback `?? []` silenciosamente e o estado de carregamento podia
  // ficar inconsistente. Validamos shape em runtime e aceitamos as três
  // formas mais comuns para robustez futura.
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (e) {
    console.warn("[agentes] response not JSON", e);
    return [];
  }

  if (Array.isArray(raw)) return raw as Agent[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.agents)) return obj.agents as Agent[];
    if (Array.isArray(obj.data)) return obj.data as Agent[];
  }
  console.warn("[agentes] unexpected response shape:", raw);
  return [];
}

async function apiCreateAgent(agent: Agent): Promise<Agent> {
  const res = await fetch("/api/client/agentes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent),
  });
  if (!res.ok) throw new Error(`POST /api/client/agentes ${res.status}`);
  const data = (await res.json()) as { agent: Agent };
  return data.agent;
}

async function apiUpdateAgent(agent: Agent): Promise<Agent> {
  const res = await fetch(`/api/client/agentes/${encodeURIComponent(agent.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent),
  });
  if (!res.ok) throw new Error(`PUT /api/client/agentes/${agent.id} ${res.status}`);
  const data = (await res.json()) as { agent?: Agent };
  return data.agent ?? agent;
}

async function apiDeleteAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE /api/client/agentes/${agentId} ${res.status}`);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function AgentsGridSkeleton() {
  return (
    <div
      className="grid min-w-0 auto-rows-fr justify-start gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),22.5rem))] xl:gap-4"
      aria-label="Carregando agentes"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="panel-surface-card min-h-[280px] rounded-xl border border-line bg-surface-card p-3.5 sm:p-4"
        >
          <div className="animate-pulse space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-surface-elevated" />
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded bg-surface-elevated" />
                  <div className="h-3 w-24 rounded bg-surface-elevated/80" />
                </div>
              </div>
              <div className="h-7 w-20 rounded-full bg-surface-elevated" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-surface-elevated/80" />
              <div className="h-3 w-4/5 rounded bg-surface-elevated/70" />
              <div className="h-3 w-2/3 rounded bg-surface-elevated/60" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="h-16 rounded-xl bg-surface-elevated/70" />
              <div className="h-16 rounded-xl bg-surface-elevated/70" />
            </div>
            <div className="h-10 rounded-xl bg-surface-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="panel-surface-card overflow-hidden rounded-xl border border-dashed border-line bg-surface-card px-5 py-10 text-center sm:px-8 sm:py-14">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Bot className="h-7 w-7" strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-content">Nenhum agente criado ainda</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-content-muted">
        Crie seu primeiro agente para automatizar atendimentos, conectar canais e manter tudo sincronizado com o CRM.
      </p>
      <Button
        type="button"
        onClick={onCreate}
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
        Criar primeiro agente
      </Button>
    </section>
  );
}

function AgentsListSectionInner({ session }: { session: ClientSession }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantId = session.tenantId;

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadedFromDb, setLoadedFromDb] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [manageAgent, setManageAgent] = useState<Agent | null>(null);
  const [manageFormKey, setManageFormKey] = useState(0);

  const limit = getPlanIncludedAgentLimitForSession(session);
  const activeCount = agents.filter((agent) => agent.status === "ativo").length;
  const atAgentCap = activeCount >= limit;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Load from Supabase on mount.
  //
  // CRÍTICO: a versão anterior usava .then/.catch separados e setava
  // `setLoadedFromDb(true)` em AMBOS os handlers. Se `applySavedAgentOrder`
  // (executada dentro do .then) levantasse uma exceção síncrona, a rejeição
  // não era propagada para o .catch chained (porque o setAgents acontece
  // antes do setLoadedFromDb, e qualquer throw cai num caminho sem catch).
  // Isso deixava o componente preso no skeleton apesar de a API responder
  // 200. Reescrito com try/catch/finally: `loadedFromDb` agora vira `true`
  // SEMPRE após o fetch retornar, mesmo se o consumo do payload falhar.
  useEffect(() => {
    let cancelled = false;
    setLoadedFromDb(false);

    void (async () => {
      try {
        const dbAgents = await apiLoadAgents();
        if (cancelled) return;
        try {
          setAgents(applySavedAgentOrder(dbAgents, tenantId));
        } catch (e) {
          console.warn("[agentes] applySavedAgentOrder falhou:", e);
          setAgents(dbAgents);
        }
      } catch (e) {
        if (cancelled) return;
        console.warn("[agentes] falha ao carregar:", e);
        setAgents([]);
      } finally {
        if (!cancelled) setLoadedFromDb(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const handleAgentsDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setAgents((items) => {
        const oldIndex = items.findIndex((a) => a.id === active.id);
        const newIndex = items.findIndex((a) => a.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return items;
        const next = arrayMove(items, oldIndex, newIndex);
        persistAgentOrder(next, tenantId);
        return next;
      });
    },
    [tenantId],
  );

  const openCreateOverlay = useCallback(() => {
    setCreateFormKey((k) => k + 1);
    setCreateOpen(true);
  }, []);

  const openManageAgent = useCallback((agent: Agent) => {
    setManageFormKey((k) => k + 1);
    setManageAgent(agent);
  }, []);

  const closeManageAgent = useCallback(() => {
    setManageAgent(null);
  }, []);

  const closeCreateOverlay = useCallback(() => {
    setCreateOpen(false);
    if (searchParams?.get("criar") === "1") {
      router.replace("/dashboard/agentes", { scroll: false });
    }
  }, [router, searchParams]);

  const criarParam = searchParams?.get("criar") ?? "";
  useEffect(() => {
    if (criarParam === "1") {
      openCreateOverlay();
    }
  }, [criarParam, openCreateOverlay]);

  // Create: optimistic update + persist to DB
  const handleAgentCreated = useCallback(
    async (agent: Agent) => {
      setAgents((current) => [agent, ...current]);
      try {
        const saved = await apiCreateAgent(agent);
        setAgents((current) => current.map((a) => (a.id === agent.id ? saved : a)));
      } catch (e) {
        console.warn("[agentes] falha ao criar no DB:", e);
      }
    },
    [],
  );

  // Update: optimistic update + persist to DB
  const handleAgentUpdated = useCallback(async (updated: Agent) => {
    setAgents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    try {
      const saved = await apiUpdateAgent(updated);
      setAgents((current) => current.map((item) => (item.id === updated.id ? saved : item)));
    } catch (e) {
      console.warn("[agentes] falha ao atualizar no DB:", e);
    }
  }, []);

  // Delete: optimistic update + persist to DB
  const handleAgentDeleted = useCallback(
    (agentId: string) => {
      setAgents((current) => {
        const next = current.filter((item) => item.id !== agentId);
        persistAgentOrder(next, tenantId);
        return next;
      });
      apiDeleteAgent(agentId).catch((e) => console.warn("[agentes] falha ao apagar no DB:", e));
    },
    [tenantId],
  );

  // Toggle status: optimistic + persist
  const handleToggleStatus = useCallback(async (agentId: string) => {
    setAgents((current) => {
      const next = current.map((item) =>
        item.id === agentId
          ? { ...item, status: item.status === "ativo" ? ("pausado" as const) : ("ativo" as const) }
          : item,
      );
      const toggled = next.find((a) => a.id === agentId);
      if (toggled) {
        apiUpdateAgent(toggled).catch((e) => console.warn("[agentes] falha ao atualizar status:", e));
      }
      return next;
    });
  }, []);

  // Duplicate: optimistic + persist
  const handleDuplicate = useCallback(async (agentId: string) => {
    setAgents((current) => {
      const target = current.find((item) => item.id === agentId);
      if (!target) return current;
      const copy: Agent = {
        ...target,
        id: `${target.id}-copy-${Date.now()}`,
        nome: `${target.nome} (Cópia)`,
        status: "inativo",
      };
      apiCreateAgent(copy).catch((e) => console.warn("[agentes] falha ao duplicar no DB:", e));
      return [...current, copy];
    });
  }, []);

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6">
      <AgentCreateOverlay
        open={createOpen}
        onClose={closeCreateOverlay}
        session={session}
        formKey={createFormKey}
        onCreated={handleAgentCreated}
      />

      <AgentManageOverlay
        agent={manageAgent}
        onClose={closeManageAgent}
        formKey={manageFormKey}
        onUpdated={handleAgentUpdated}
        onDeleted={handleAgentDeleted}
      />

      <div className="panel-surface-card w-full max-w-[46rem] overflow-hidden rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(13.5rem,16rem)] md:items-center">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              <Sparkles className="h-3 w-3" strokeWidth={1.9} aria-hidden />
              Central de agentes IA
            </div>
            <h2 className="mt-3 text-[1.65rem] font-semibold leading-tight tracking-[-0.03em] text-content sm:text-[2rem]">
              Meus Agentes
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-content-muted">
              {loadedFromDb
                ? "Organize seus agentes, acompanhe uso e conecte cada automação aos canais certos. Arraste pela alça do cartão para reorganizar."
                : "A carregar agentes…"}
            </p>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-1">
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-surface-elevated/35 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Activity className="h-4 w-4" strokeWidth={1.85} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-content-muted">Agentes ativos</p>
                  <p className="text-sm font-semibold text-content">{activeCount} de {limit}</p>
                </div>
              </div>
              <Badge className="shrink-0 border-primary/25 bg-primary/10 text-xs font-semibold text-primary">
                {activeCount}/{limit}
              </Badge>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Button
                type="button"
                onClick={openCreateOverlay}
                disabled={atAgentCap}
                title={atAgentCap ? `Limite de ${limit} agentes ativos no plano.` : undefined}
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
                Novo agente
              </Button>
              <Link
                href="/planos"
                className="max-w-[20rem] text-balance text-left text-[11px] font-semibold leading-relaxed text-primary underline-offset-2 hover:underline"
              >
                Comprar mais agentes — {formatBRL(EXTRA_AGENT_MONTHLY_BRL)}/mês por agente extra
              </Link>
            </div>
          </div>
        </div>
      </div>

      {!loadedFromDb ? (
        <AgentsGridSkeleton />
      ) : agents.length === 0 ? (
        <AgentsEmptyState onCreate={openCreateOverlay} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAgentsDragEnd}>
          <SortableContext items={agents.map((a) => a.id)} strategy={rectSortingStrategy}>
            <div className="grid min-w-0 auto-rows-fr justify-start gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),22.5rem))] xl:gap-4">
              {agents.map((agent) => (
                <SortableAgentCard
                  key={agent.id}
                  agent={agent}
                  onManage={() => openManageAgent(agent)}
                  onToggleStatus={handleToggleStatus}
                  onDuplicate={handleDuplicate}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/** `useSearchParams` tem de estar sob Suspense (rotas como `/dashboard/agentes` via shell). */
export function AgentsListSection({ session }: { session: ClientSession }) {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-line bg-surface-card p-8 text-center text-sm text-content-muted">
          A carregar agentes…
        </div>
      }
    >
      <AgentsListSectionInner session={session} />
    </Suspense>
  );
}

export function AgentConversationsSection({
  session,
  agentId,
}: {
  session: ClientSession;
  agentId: string;
}) {
  const agents = useMemo(() => listAgentsForTenant(session.tenantId), [session.tenantId]);
  const agent = agents.find((item) => item.id === agentId);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const rows = [
    { contato: "Marina Costa", etapa: "Qualificação", status: "ativa", handoff: "não", data: "Hoje 11:32" },
    { contato: "Lucas Rios", etapa: "CTA", status: "convertida", handoff: "sim", data: "Hoje 10:10" },
    { contato: "Patrícia Alves", etapa: "Apresentação", status: "andamento", handoff: "não", data: "Ontem 18:12" },
  ].filter((item) => {
    const matchSearch = `${item.contato} ${item.etapa}`.toLowerCase().includes(search.toLowerCase());
    const matchStatus = status === "todos" ? true : item.status === status;
    return matchSearch && matchStatus;
  });

  if (!agent) {
    return (
      <section className="rounded-xl border border-line bg-surface-card p-6">
        <p className="text-sm text-content-secondary">Agente não encontrado para este cliente.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-content">{agent.nome} - Conversas</h2>
          <p className="text-sm text-content-muted">Conversas associadas a este agente.</p>
        </div>
        <Badge className="border-primary/25 bg-primary/10 text-primary">{agent.metricas.conversasHoje} conversas hoje</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Total conversas" value={`${agent.metricas.conversasHoje * 22}`} />
        <Metric label="Leads convertidos" value={`${agent.metricas.leadsConvertidos}`} />
        <Metric label="Taxa de handoff" value={`${agent.metricas.handoffRate.toFixed(1)}%`} />
        <Metric label="Satisfação média" value={`${agent.metricas.satisfacaoMedia.toFixed(1)}`} />
        <Metric label="Tempo médio" value={`${agent.metricas.tempoMedioMin} min`} />
      </div>

      <section className="rounded-xl border border-line bg-surface-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Buscar contato" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Input type="date" />
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="todos">Todos os status</option>
            <option value="ativa">Ativa</option>
            <option value="andamento">Andamento</option>
            <option value="convertida">Convertida</option>
          </Select>
          <Select>
            <option>Todas as etapas</option>
            {agent.fluxo.map((step) => (
              <option key={step.id}>{step.nome}</option>
            ))}
          </Select>
        </div>
        <div className="mt-4 min-w-0 overflow-x-auto [-webkit-overflow-scrolling:touch] touch-pan-x">
          <table className="min-w-full text-sm">
            <thead>
              <tr className={`text-left ${typography.ui.overline}`}>
                <th className="px-3 py-2">Contato</th>
                <th className="px-3 py-2">Etapa</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Handoff</th>
                <th className="px-3 py-2">Última interação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.contato}-${row.data}`} className="border-t border-line/70 text-content-secondary">
                  <td className="px-3 py-3">{row.contato}</td>
                  <td className="px-3 py-3">{row.etapa}</td>
                  <td className="px-3 py-3">{row.status}</td>
                  <td className="px-3 py-3">{row.handoff}</td>
                  <td className="px-3 py-3">{row.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-card p-4">
      <p className="text-xs text-content-faint">{label}</p>
      <p className="mt-1 text-xl font-semibold text-content">{value}</p>
    </div>
  );
}
