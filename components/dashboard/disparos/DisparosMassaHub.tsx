"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  Gauge,
  Layers,
  Send,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import type { ClientSession } from "@/lib/client-auth";
import type { Agent } from "@/lib/types";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import { CrmDestinationBlock } from "@/components/dashboard/agentes/CrmDestinationBlock";
import { AgentCreateOverlay, AgentManageOverlay } from "@/components/dashboard/agentes/AgentCreateOverlay";
import { WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import {
  loadDisparosDrafts,
  persistDisparosDrafts,
  type DisparosDraft,
} from "@/components/dashboard/disparos/disparos-drafts-storage";
import { SITUATION_TEMPLATES } from "@/components/dashboard/disparos/disparos-situation-templates";
import {
  buildAudienceBlocksPayload,
  createCrmBlock,
  DisparosPublicoBuilder,
  estimatePublicoTotal,
  hasUsablePublico,
  type PublicoBlock,
} from "@/components/dashboard/disparos/DisparosPublicoBuilder";
import { DisparosCampanhasList, type DisparosHistoryRow } from "@/components/dashboard/disparos/DisparosCampanhasList";

const DEFAULT_MESSAGE =
  "Ola {{nome}}, preparamos uma condicao especial para {{empresa}}. Responda SIM para receber o link seguro.";

const THROUGHPUT = [
  { id: "suave" as const, label: "Suave", perMinute: 10, sub: "Mais seguro — 10 msgs/min" },
  { id: "normal" as const, label: "Normal", perMinute: 20, sub: "Equilíbrio recomendado — 20 msgs/min" },
  { id: "acelerado" as const, label: "Acelerado", perMinute: 40, sub: "Só se o número já é bem estabelecido — 40 msgs/min" },
];

const WEEK_DAYS = [
  { label: "Dom", value: 0 },
  { label: "Seg", value: 1 },
  { label: "Ter", value: 2 },
  { label: "Qua", value: 3 },
  { label: "Qui", value: 4 },
  { label: "Sex", value: 5 },
  { label: "Sáb", value: 6 },
];

const VARIABLES = [
  { snippet: "{{nome}}", sample: "Marina" },
  { snippet: "{{empresa}}", sample: "Clinica Vista" },
  { snippet: "{{telefone}}", sample: "(11) 98765-4321" },
];

function insertAtCaret(textarea: HTMLTextAreaElement, snippet: string) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const next = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
  textarea.value = next;
  const pos = start + snippet.length;
  textarea.setSelectionRange(pos, pos);
}

function previewBody(body: string) {
  return body
    .replaceAll("{{nome}}", "Marina")
    .replaceAll("{{empresa}}", "Clinica Vista")
    .replaceAll("{{telefone}}", "(11) 98765-4321");
}

function previewMetaTemplate(bodyText: string | null) {
  if (!bodyText) return null;
  return bodyText
    .replaceAll("{{1}}", "Marina")
    .replaceAll("{{2}}", "Clinica Vista")
    .replaceAll("{{3}}", "(11) 98765-4321");
}

const MAX_DRAFTS = 30;

type CampaignConnection = {
  connectionId: string;
  transport: "evolution" | "cloud_api";
  label: string;
  slotIndex: number | null;
  connected: boolean;
};

type CampaignAgent = {
  agent_id: string;
  display_name: string | null;
};

type MetaTemplate = {
  name: string;
  status: string;
  category: string | null;
  language: string | null;
  bodyText: string | null;
  bodyParamCount: number;
};

type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "scheduled" | "processing" | "completed" | "cancelled" | "failed";
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  scheduled_at: string | null;
  created_at: string;
};

function newDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Numerozinho de passo — só orientação visual pro leigo saber onde está, sem afetar nada funcional. */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
      {n}
    </span>
  );
}

/**
 * CRUD genérico de agentes, mesmo endpoint de /dashboard/agentes — um agente
 * de Disparos é só uma linha de tenant_agents com `isBroadcastAgent: true` no
 * metadata, sem rota própria (ver lib/server/broadcast-agent-identity.ts).
 */
async function saveAgentToDb(agent: Agent, method: "POST" | "PUT"): Promise<Agent> {
  const url = method === "POST" ? "/api/client/agentes" : `/api/client/agentes/${encodeURIComponent(agent.id)}`;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent),
  });
  const data = (await response.json().catch(() => ({}))) as { agent?: Agent; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o agente de disparos.");
  return data.agent ?? agent;
}

async function deleteAgentFromDb(agentId: string): Promise<void> {
  const response = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Não foi possível remover o agente de disparos.");
}

export function DisparosMassaHub({ session }: { session: ClientSession }) {
  const { isLight } = usePanelAppearance();
  const { funnels } = useCrmFunnels();
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Tela abre sempre na lista (vazia ou com cards) — o formulário só aparece
  // quando o cliente pede pra criar ou continuar um rascunho.
  const [view, setView] = useState<"list" | "create">("list");
  const [campaignName, setCampaignName] = useState("");
  const [publicoBlocks, setPublicoBlocks] = useState<PublicoBlock[]>(() => [createCrmBlock()]);
  const [schedule, setSchedule] = useState("");
  const [body, setBody] = useState(DEFAULT_MESSAGE);
  const [throughput, setThroughput] = useState<(typeof THROUGHPUT)[number]["id"]>("normal");
  // Janela de envio: desligada por padrão mantém o comportamento de sempre
  // (envia a qualquer hora). Ligada, só envia nos dias e horários escolhidos.
  const [windowActive, setWindowActive] = useState(false);
  const [windowDays, setWindowDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  // Destino do lead ao entrar no disparo: desligado por padrão mantém o
  // comportamento de sempre (funil/coluna e vendedor responsável não mudam).
  // A troca do agente de IA não é opção aqui — acontece sempre, no servidor.
  const [destMoveEnabled, setDestMoveEnabled] = useState(false);
  const [destFunnelId, setDestFunnelId] = useState("");
  const [destColumnId, setDestColumnId] = useState("");
  const [destReleaseOwner, setDestReleaseOwner] = useState(false);
  const [drafts, setDrafts] = useState<DisparosDraft[]>([]);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [connections, setConnections] = useState<CampaignConnection[]>([]);
  const [agents, setAgents] = useState<CampaignAgent[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [agentMode, setAgentMode] = useState<"existing" | "disparos">("existing");
  const [agentId, setAgentId] = useState("");
  // Agentes de Disparos: lista completa vem de /api/client/agentes (mesma
  // rota de /dashboard/agentes) — filtrada aqui por isBroadcastAgent, porque
  // é o único jeito de ter o objeto Agent inteiro pra editar inline.
  const [fullAgents, setFullAgents] = useState<Agent[]>([]);
  const [broadcastAgentLimit, setBroadcastAgentLimit] = useState(1);
  const [broadcastAgentId, setBroadcastAgentId] = useState("");
  const [createBroadcastOpen, setCreateBroadcastOpen] = useState(false);
  const [manageBroadcastAgent, setManageBroadcastAgent] = useState<Agent | null>(null);
  const [broadcastFormKey, setBroadcastFormKey] = useState(0);
  const [eligibleRecipients, setEligibleRecipients] = useState(0);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [metaTemplateName, setMetaTemplateName] = useState("");
  const [processingCampaignId, setProcessingCampaignId] = useState<string | null>(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setDrafts(loadDisparosDrafts());
  }, []);

  const loadCampaignData = useCallback(async () => {
    try {
      const response = await fetch("/api/client/whatsapp-campaigns", { cache: "no-store" });
      const payload = (await response.json()) as {
        error?: string;
        campaigns?: CampaignRow[];
        connections?: CampaignConnection[];
        agents?: CampaignAgent[];
        eligibleRecipients?: number;
        broadcastAgentLimit?: number;
        availableTags?: string[];
      };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar campanhas.");
      setCampaigns(payload.campaigns ?? []);
      setConnections(payload.connections ?? []);
      setAgents(payload.agents ?? []);
      setEligibleRecipients(payload.eligibleRecipients ?? 0);
      setBroadcastAgentLimit(typeof payload.broadcastAgentLimit === "number" ? payload.broadcastAgentLimit : 1);
      setAvailableTags(payload.availableTags ?? []);
      setConnectionId((current) => current || payload.connections?.[0]?.connectionId || "");
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Não foi possível carregar campanhas.");
    }
  }, []);

  const loadFullAgents = useCallback(async () => {
    try {
      const response = await fetch("/api/client/agentes", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { agents?: Agent[] };
      setFullAgents(payload.agents ?? []);
    } catch {
      // Silencioso: a tela de disparos continua funcionando com o agente
      // padrão criado no servidor, só perde a edição inline aqui.
    }
  }, []);

  useEffect(() => {
    void loadCampaignData();
    void loadFullAgents();
  }, [loadCampaignData, loadFullAgents]);

  const broadcastAgents = useMemo(
    () => fullAgents.filter((agent) => agent.isBroadcastAgent === true),
    [fullAgents],
  );
  const activeBroadcastCount = useMemo(
    () => broadcastAgents.filter((agent) => agent.status === "ativo").length,
    [broadcastAgents],
  );
  const atBroadcastAgentCap = activeBroadcastCount >= broadcastAgentLimit;

  // Seleciona o primeiro automaticamente quando existe pelo menos um salvo e
  // nada foi escolhido ainda (ou o escolhido sumiu — ex.: foi apagado).
  useEffect(() => {
    if (broadcastAgents.length === 0) return;
    if (broadcastAgentId && broadcastAgents.some((agent) => agent.id === broadcastAgentId)) return;
    setBroadcastAgentId(broadcastAgents[0]!.id);
  }, [broadcastAgents, broadcastAgentId]);

  const handleBroadcastAgentCreated = useCallback((agent: Agent) => {
    // O wizard cria todo agente novo "inativo" por padrão — mas o cliente
    // acabou de configurar este pra usar JÁ nesta campanha, então força ativo
    // (mesmo comportamento que ensureDisparosDefaultAgent já tinha no servidor).
    const stamped: Agent = { ...agent, isBroadcastAgent: true, status: "ativo" };
    setFullAgents((current) => [stamped, ...current]);
    setBroadcastAgentId(stamped.id);
    saveAgentToDb(stamped, "POST")
      .then((saved) => setFullAgents((current) => current.map((a) => (a.id === stamped.id ? saved : a))))
      .catch((error) => {
        setFullAgents((current) => current.filter((a) => a.id !== stamped.id));
        setBroadcastAgentId((current) => (current === stamped.id ? "" : current));
        setCampaignError(error instanceof Error ? error.message : "Não foi possível salvar o agente de disparos.");
      });
  }, []);

  const handleBroadcastAgentUpdated = useCallback((agent: Agent) => {
    const stamped: Agent = { ...agent, isBroadcastAgent: true };
    setFullAgents((current) => current.map((a) => (a.id === stamped.id ? stamped : a)));
    saveAgentToDb(stamped, "PUT")
      .then((saved) => setFullAgents((current) => current.map((a) => (a.id === stamped.id ? saved : a))))
      .catch((error) => {
        setCampaignError(error instanceof Error ? error.message : "Não foi possível salvar o agente de disparos.");
      });
  }, []);

  const handleBroadcastAgentDeleted = useCallback((deletedAgentId: string) => {
    setFullAgents((current) => current.filter((a) => a.id !== deletedAgentId));
    setBroadcastAgentId((current) => (current === deletedAgentId ? "" : current));
    deleteAgentFromDb(deletedAgentId).catch((error) => {
      console.warn("[disparos] falha ao apagar agente de disparos:", error);
    });
  }, []);

  const selectedConnection = useMemo(
    () => connections.find((c) => c.connectionId === connectionId) ?? null,
    [connections, connectionId],
  );
  const isMetaTransport = selectedConnection?.transport === "cloud_api";

  // Carrega templates aprovados quando a linha escolhida é API Meta.
  useEffect(() => {
    if (!isMetaTransport || !connectionId) {
      setMetaTemplates([]);
      setMetaTemplateName("");
      return;
    }
    let cancelled = false;
    fetch(`/api/client/whatsapp-campaigns/meta-templates?connectionId=${encodeURIComponent(connectionId)}`)
      .then((r) => r.json())
      .then((data: { templates?: MetaTemplate[] }) => {
        if (cancelled) return;
        setMetaTemplates(data.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setMetaTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isMetaTransport, connectionId]);

  const scheduleSummary = schedule
    ? new Date(schedule).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "Enviar agora";
  const throughputLabel = THROUGHPUT.find((t) => t.id === throughput)?.label ?? "Normal";

  /**
   * Aviso — nunca bloqueio. Quem decide é o dono do número; o nosso papel é
   * ele não descobrir o risco depois que o WhatsApp já derrubou a linha.
   *
   * Dois perigos diferentes: mandar rápido demais (ritmo) e concentrar muita
   * mensagem numa janela curta, que é o padrão que mais parece robô.
   */
  const riskWarning = useMemo(() => {
    const perMinute = THROUGHPUT.find((t) => t.id === throughput)?.perMinute ?? 20;
    // Quem de fato vai receber: só lead com opt-in ativo entra no disparo.
    // Estimativa somada de todos os públicos — pode contar duas vezes quem
    // está em mais de um bloco, o dedupe de verdade é no servidor.
    const total = estimatePublicoTotal(publicoBlocks);
    if (total <= 0) return null;

    const avisos: string[] = [];
    if (throughput === "acelerado") {
      avisos.push(
        "o ritmo Acelerado (40 msgs/min) só é seguro em número já aquecido, com histórico de conversa",
      );
    }

    if (windowActive) {
      const [h1 = 0, m1 = 0] = windowStart.split(":").map(Number);
      const [h2 = 0, m2 = 0] = windowEnd.split(":").map(Number);
      const minutosPorDia = Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
      const capacidadeDiaria = minutosPorDia * perMinute;
      if (windowDays.length === 0) {
        avisos.push("nenhum dia da semana está marcado, então nada vai ser enviado");
      } else if (capacidadeDiaria > 0 && total > capacidadeDiaria * 3) {
        const dias = Math.ceil(total / capacidadeDiaria);
        avisos.push(
          `nessa janela cabem ~${capacidadeDiaria.toLocaleString("pt-BR")} mensagens por dia, então esta lista levaria ~${dias} dia(s) de envio`,
        );
      } else if (minutosPorDia > 0 && minutosPorDia <= 120 && total > 300) {
        avisos.push(
          "concentrar muita mensagem numa janela curta é o padrão que mais chama atenção do WhatsApp",
        );
      }
    } else if (total > 500) {
      avisos.push(
        "sem janela de horário, o envio pode cair de madrugada — hora em que resposta é rara e denúncia é comum",
      );
    }

    if (avisos.length === 0) return null;
    return `Atenção: ${avisos.join("; ")}. Isso pode fazer o WhatsApp bloquear seu número.`;
  }, [throughput, windowActive, windowStart, windowEnd, windowDays, publicoBlocks]);
  const charCount = body.length;
  const preview = previewBody(body);
  const selectedMetaTemplate = useMemo(
    () => metaTemplates.find((t) => t.name === metaTemplateName) ?? null,
    [metaTemplates, metaTemplateName],
  );
  const metaPreview = previewMetaTemplate(selectedMetaTemplate?.bodyText ?? null);

  const appendVariable = useCallback((snippet: string) => {
    const el = taRef.current;
    if (!el) {
      setBody((v) => (v.endsWith(" ") || v.length === 0 ? v + snippet : `${v} ${snippet}`));
      return;
    }
    el.focus();
    insertAtCaret(el, snippet);
    setBody(el.value);
  }, []);

  const commitDrafts = useCallback((buildNext: (prev: DisparosDraft[]) => DisparosDraft[]) => {
    setDrafts((prev) => {
      const next = buildNext(prev).slice(0, MAX_DRAFTS);
      persistDisparosDrafts(next);
      return next;
    });
  }, []);

  const handleSaveDraft = useCallback(() => {
    setSavingDraft(true);
    const stamp = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const name = campaignName.trim() || `Rascunho ${stamp}`;
    // Só os blocos de CRM são salvos no rascunho — lista importada e contatos
    // digitados já viraram leads reais no momento em que foram confirmados,
    // então recarregar o rascunho depois não teria o que "desfazer" ali.
    const draft: DisparosDraft = {
      id: newDraftId(),
      name,
      audienceBlocks: publicoBlocks
        .filter((b): b is Extract<PublicoBlock, { kind: "crm" }> => b.kind === "crm")
        .map((b) => ({ filtro: b.filtro, valor: b.valor })),
      schedule,
      throughput,
      body,
      updatedAt: new Date().toISOString(),
    };
    commitDrafts((prev) => [draft, ...prev]);
    setDraftNotice("Rascunho salvo neste navegador (local).");
    window.setTimeout(() => setDraftNotice(null), 4500);
    window.setTimeout(() => setSavingDraft(false), 400);
  }, [body, campaignName, commitDrafts, publicoBlocks, schedule, throughput]);

  const handleLoadDraft = useCallback((d: DisparosDraft) => {
    setCampaignName(d.name);
    setPublicoBlocks(
      d.audienceBlocks.length > 0
        ? d.audienceBlocks.map((b) => ({ ...createCrmBlock(), filtro: b.filtro, valor: b.valor }))
        : [createCrmBlock()],
    );
    setSchedule(d.schedule);
    setThroughput(d.throughput);
    setBody(d.body);
    setDraftNotice("Rascunho carregado no editor.");
    window.setTimeout(() => setDraftNotice(null), 3500);
  }, []);

  const handleDeleteDraft = useCallback(
    (id: string) => {
      commitDrafts((prev) => prev.filter((d) => d.id !== id));
      setDraftNotice("Rascunho removido.");
      window.setTimeout(() => setDraftNotice(null), 3000);
    },
    [commitDrafts],
  );

  /** Volta o formulário aos padrões — usado ao abrir "Nova campanha" pra não herdar sobra de uma edição anterior. */
  const resetCampaignForm = useCallback(() => {
    setCampaignName("");
    setPublicoBlocks([createCrmBlock()]);
    setSchedule("");
    setBody(DEFAULT_MESSAGE);
    setThroughput("normal");
    setWindowActive(false);
    setWindowDays([1, 2, 3, 4, 5]);
    setWindowStart("09:00");
    setWindowEnd("18:00");
    setAgentMode("existing");
    setAgentId("");
    setMetaTemplateName("");
    setShowTemplateGallery(false);
    setShowAdvanced(false);
    setCampaignError(null);
  }, []);

  const handleCreateNew = useCallback(() => {
    resetCampaignForm();
    setDraftNotice(null);
    setView("create");
  }, [resetCampaignForm]);

  const handleEditDraft = useCallback(
    (d: DisparosDraft) => {
      handleLoadDraft(d);
      setView("create");
    },
    [handleLoadDraft],
  );

  const applySituationTemplate = useCallback((text: string, title: string) => {
    setBody(text);
    if (!campaignName.trim()) setCampaignName(`Campanha · ${title}`);
    setDraftNotice(`Modelo "${title}" aplicado ao editor.`);
    window.setTimeout(() => setDraftNotice(null), 3500);
  }, [campaignName]);

  const history = useMemo(
    () =>
      campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        delivered:
          campaign.total_recipients > 0
            ? Math.round((campaign.total_sent / campaign.total_recipients) * 100)
            : 0,
        status: campaign.status,
        window: campaign.scheduled_at
          ? new Date(campaign.scheduled_at).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })
          : "Imediato",
      })),
    [campaigns],
  );

  const canSchedule =
    Boolean(connectionId) &&
    Boolean(campaignName.trim()) &&
    (agentMode === "disparos" || Boolean(agentId)) &&
    hasUsablePublico(publicoBlocks) &&
    (isMetaTransport ? Boolean(metaTemplateName) : Boolean(body.trim()));

  const handleScheduleCampaign = useCallback(async () => {
    setCampaignBusy(true);
    setCampaignError(null);
    try {
      const response = await fetch("/api/client/whatsapp-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName,
          connectionId,
          agentMode,
          agentId: agentMode === "existing" ? agentId : broadcastAgentId || undefined,
          audienceBlocks: buildAudienceBlocksPayload(publicoBlocks),
          messageTemplate: isMetaTransport ? "" : body,
          metaTemplateName: isMetaTransport ? metaTemplateName : undefined,
          metaTemplateLang: isMetaTransport ? selectedMetaTemplate?.language ?? "pt_BR" : undefined,
          throughput,
          scheduledAt: schedule || null,
          sendWindow: windowActive
            ? {
                ativo: true,
                diasAtivos: windowDays,
                horaInicio: Number(windowStart.split(":")[0] ?? 9),
                minutoInicio: Number(windowStart.split(":")[1] ?? 0),
                horaFim: Number(windowEnd.split(":")[0] ?? 18),
                minutoFim: Number(windowEnd.split(":")[1] ?? 0),
              }
            : null,
          leadDestination: {
            moveToFunnel: destMoveEnabled,
            funnelId: destFunnelId || null,
            columnId: destColumnId || null,
            releaseOwner: destReleaseOwner,
          },
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível agendar a campanha.");
      setDraftNotice("Campanha criada — os primeiros envios já começaram.");
      window.setTimeout(() => setDraftNotice(null), 4500);
      await loadCampaignData();
      setView("list");
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Não foi possível agendar a campanha.");
    } finally {
      setCampaignBusy(false);
    }
  }, [
    agentId,
    agentMode,
    body,
    campaignName,
    connectionId,
    isMetaTransport,
    loadCampaignData,
    metaTemplateName,
    publicoBlocks,
    schedule,
    selectedMetaTemplate,
    throughput,
    windowActive,
    windowDays,
    windowStart,
    windowEnd,
    destMoveEnabled,
    destFunnelId,
    destColumnId,
    destReleaseOwner,
    broadcastAgentId,
  ]);

  const handleCancelCampaign = useCallback(async (campaignId: string) => {
    const response = await fetch(`/api/client/whatsapp-campaigns/${encodeURIComponent(campaignId)}`, {
      method: "DELETE",
    });
    if (response.ok) await loadCampaignData();
  }, [loadCampaignData]);

  const handleProcessNow = useCallback(
    async (campaignId: string) => {
      setProcessingCampaignId(campaignId);
      try {
        await fetch(`/api/client/whatsapp-campaigns/${encodeURIComponent(campaignId)}/process`, { method: "POST" });
        await loadCampaignData();
      } finally {
        setProcessingCampaignId(null);
      }
    },
    [loadCampaignData],
  );

  return (
    <div className="space-y-6">
      {draftNotice ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium",
            isLight ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
          )}
          role="status"
        >
          <Check className="size-4 shrink-0 text-emerald-500" aria-hidden />
          {draftNotice}
        </div>
      ) : null}
      {campaignError ? (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-500" role="alert">
          {campaignError}
        </div>
      ) : null}

      {view === "list" ? (
        <DisparosCampanhasList
          isLight={isLight}
          history={history}
          drafts={drafts}
          processingCampaignId={processingCampaignId}
          onCreateNew={handleCreateNew}
          onEditDraft={handleEditDraft}
          onDeleteDraft={handleDeleteDraft}
          onCancelCampaign={handleCancelCampaign}
          onProcessNow={handleProcessNow}
        />
      ) : (
        <>
          <AgentCreateOverlay
            open={createBroadcastOpen}
            onClose={() => setCreateBroadcastOpen(false)}
            session={session}
            formKey={broadcastFormKey}
            onCreated={handleBroadcastAgentCreated}
          />
          <AgentManageOverlay
            agent={manageBroadcastAgent}
            onClose={() => setManageBroadcastAgent(null)}
            formKey={broadcastFormKey}
            onUpdated={handleBroadcastAgentUpdated}
            onDeleted={handleBroadcastAgentDeleted}
          />
          <button
            type="button"
            onClick={() => setView("list")}
            className="flex items-center gap-1.5 text-xs font-medium text-content-secondary transition-colors hover:text-content"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Voltar
          </button>
          <div
            className={cn(
              "relative overflow-hidden rounded-xl border p-6 sm:p-8",
              isLight
                ? "border-slate-200/90 bg-surface-deep"
                : "border-line/80 bg-surface-card",
            )}
          >
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <h3 className="text-balance text-2xl font-semibold tracking-tight text-content sm:text-3xl">
              Nova campanha
            </h3>
            <p className="max-w-xl text-pretty text-sm leading-relaxed text-content-secondary sm:text-base">
              Siga os passos abaixo — o envio começa assim que você confirmar.
            </p>
            <div className="flex items-center gap-2 pt-1 text-xs text-content-secondary">
              <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
              Só entram leads que autorizaram receber WhatsApp.
            </div>
          </div>
          <div className="grid min-w-0 shrink-0 grid-cols-1 gap-2 min-[390px]:grid-cols-2 sm:gap-3 lg:w-[min(100%,260px)]">
            {[
              { icon: Users, label: "Autorizados", value: eligibleRecipients.toLocaleString("pt-BR"), tone: "text-primary/85" },
              { icon: Activity, label: "Ritmo atual", value: `${throughputLabel}`, tone: "text-primary" },
            ].map(({ icon: Icon, label, value, tone }) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl border p-3 text-center sm:p-4",
                  isLight ? "border-slate-200/80 bg-surface-deep" : "border-line/70 bg-surface-deep",
                )}
              >
                <Icon className={cn("mx-auto mb-2 size-5 opacity-90", tone)} aria-hidden />
                <div className="text-[10px] font-medium uppercase tracking-wider text-content-secondary">{label}</div>
                <div className="mt-1 truncate text-sm font-semibold text-content">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-5">
          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">Nome da campanha</label>
              <Input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Ex.: Reativacao Q2 · base fria"
                className="rounded-xl"
              />
            </div>

            <div className="mt-5 mb-2 flex items-center gap-2.5 text-sm font-semibold text-content">
              <StepBadge n={1} />
              <Layers className="size-4 text-primary" aria-hidden />
              Linha de envio
            </div>
            <select
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
            >
              <option value="">Selecione uma linha conectada</option>
              {connections.map((connection) => (
                <option key={connection.connectionId} value={connection.connectionId}>
                  {connection.label}
                </option>
              ))}
            </select>
            {connections.length === 0 ? (
              <p className="mt-2 text-[11px] text-content-secondary">
                Nenhuma linha conectada ainda — conecte um número em Integrações (QR Code ou API Meta).
              </p>
            ) : null}

            <div className="mt-5 mb-2 flex items-center gap-2.5 text-sm font-semibold text-content">
              <StepBadge n={2} />
              <UserCog className="size-4 text-primary" aria-hidden />
              Quem responde
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setAgentMode("existing")}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left text-sm transition-all",
                  agentMode === "existing" ? "border-primary/60 bg-primary/10" : "border-line bg-surface-card/40 hover:border-primary/35",
                )}
              >
                <div className="font-semibold text-content">Meu agente</div>
                <div className="mt-0.5 text-[11px] text-content-secondary">Escolha um dos seus agentes de IA</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAgentMode("disparos");
                  if (broadcastAgents.length === 0) {
                    setBroadcastFormKey((k) => k + 1);
                    setCreateBroadcastOpen(true);
                  }
                }}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left text-sm transition-all",
                  agentMode === "disparos" ? "border-primary/60 bg-primary/10" : "border-line bg-surface-card/40 hover:border-primary/35",
                )}
              >
                <div className="flex items-center gap-1.5 font-semibold text-content">
                  <Bot className="size-3.5 text-primary" aria-hidden />
                  Agente do Disparos
                </div>
                <div className="mt-0.5 text-[11px] text-content-secondary">
                  {broadcastAgents.length > 0
                    ? `${broadcastAgents.length} salvo${broadcastAgents.length > 1 ? "s" : ""} — separado do atendimento`
                    : "Configure agora — separado dos agentes de atendimento"}
                </div>
              </button>
            </div>
            {agentMode === "existing" ? (
              <select
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                className="mt-3 h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
              >
                <option value="">Selecione um agente</option>
                {agents.map((agent) => (
                  <option key={agent.agent_id} value={agent.agent_id}>
                    {agent.display_name || agent.agent_id}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-3 space-y-2.5">
                {broadcastAgents.length > 0 ? (
                  <>
                    <select
                      value={broadcastAgentId}
                      onChange={(event) => setBroadcastAgentId(event.target.value)}
                      className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                    >
                      {broadcastAgents.map((broadcastCandidate) => (
                        <option key={broadcastCandidate.id} value={broadcastCandidate.id}>
                          {broadcastCandidate.nome}
                          {broadcastCandidate.status !== "ativo" ? " (pausado)" : ""}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const current =
                            broadcastAgents.find((a) => a.id === broadcastAgentId) ?? broadcastAgents[0] ?? null;
                          setManageBroadcastAgent(current);
                          setBroadcastFormKey((k) => k + 1);
                        }}
                        className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-content-secondary transition-colors hover:border-primary/40 hover:text-content"
                      >
                        Configurar este agente
                      </button>
                      <button
                        type="button"
                        disabled={atBroadcastAgentCap}
                        title={
                          atBroadcastAgentCap
                            ? `Seu plano permite ${broadcastAgentLimit} agente${broadcastAgentLimit === 1 ? "" : "s"} de Disparos ativo${broadcastAgentLimit === 1 ? "" : "s"}.`
                            : undefined
                        }
                        onClick={() => {
                          setBroadcastFormKey((k) => k + 1);
                          setCreateBroadcastOpen(true);
                        }}
                        className="rounded-lg border border-primary/35 px-3 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + Criar outro agente de Disparos
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setBroadcastFormKey((k) => k + 1);
                      setCreateBroadcastOpen(true);
                    }}
                    className="flex h-11 w-full items-center justify-center rounded-xl border border-primary/35 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    Configurar agente de Disparos agora
                  </button>
                )}
                <p className="text-[11px] text-content-secondary">
                  Separado dos seus agentes de atendimento — só ele conduz quem responder a este disparo, e fica
                  salvo pra reaproveitar em outra campanha.
                </p>
              </div>
            )}
          </div>

          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-content">
              <UserCog className="size-4 text-primary" aria-hidden />
              Destino do lead no CRM
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-content-secondary">
              Quem responder ao disparo passa a ser atendido pelo agente de disparos automaticamente — isso não é
              opcional. As opções abaixo controlam só o funil/coluna e o vendedor responsável no CRM.
            </p>
            <CrmDestinationBlock
              funnels={funnels}
              enabled={destMoveEnabled}
              funnelId={destFunnelId}
              columnId={destColumnId}
              onChange={(next) => {
                setDestMoveEnabled(next.enabled);
                setDestFunnelId(next.funnelId);
                setDestColumnId(next.columnId);
              }}
              help={{
                offTitle: "Manter no funil atual",
                off: "O card do lead continua no mesmo funil e coluna de onde ele já estava.",
                onTitle: "Mover para outro funil",
                on: "Ao entrar no disparo, o card do lead é movido para o funil e coluna escolhidos abaixo.",
                funnel: "Funil para onde o card vai quando o disparo sair.",
                column: "Coluna/etapa dentro desse funil.",
              }}
            />
            <button
              type="button"
              onClick={() => setDestReleaseOwner((v) => !v)}
              className={cn(
                "mt-3 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-colors",
                destReleaseOwner
                  ? "border-primary/60 bg-primary/10 text-content"
                  : "border-line bg-surface-card/40 text-content-secondary hover:border-primary/35",
              )}
            >
              <span>
                {destReleaseOwner
                  ? "Solta o vendedor responsável — o card fica sem dono até alguém puxar de novo"
                  : "Mantém o vendedor responsável, se houver"}
              </span>
              <span className="text-[11px] font-medium text-primary">
                {destReleaseOwner ? "Ativado" : "Manter"}
              </span>
            </button>
          </div>

          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-content">
              <StepBadge n={3} />
              <Users className="size-4 text-primary" aria-hidden />
              Público
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-content-secondary">
              Combine quantos públicos quiser no mesmo disparo — CRM, lista importada e contatos
              digitados na hora. Adicione mais de um bloco do mesmo tipo se precisar (3 tags
              diferentes, por exemplo).
            </p>
            <DisparosPublicoBuilder
              blocks={publicoBlocks}
              onChange={setPublicoBlocks}
              isLight={isLight}
              onAfterOptIn={loadCampaignData}
              funnels={funnels}
              availableTags={availableTags}
            />
          </div>

          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 text-sm font-semibold text-content">
                <StepBadge n={4} />
                <Sparkles className="size-4 text-amber-400" aria-hidden />
                {isMetaTransport ? "Modelo aprovado (API Meta)" : "Mensagem"}
              </div>
              {!isMetaTransport ? (
                <span className="font-mono text-[11px] text-content-secondary">
                  {charCount} / 4096 <span className="text-content-secondary/70">caracteres</span>
                </span>
              ) : null}
            </div>

            {!isMetaTransport ? (
              <button
                type="button"
                onClick={() => setShowTemplateGallery((v) => !v)}
                className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface-card/40 px-3 py-2.5 text-left text-xs font-medium text-content-secondary transition-colors hover:border-primary/35 hover:text-content"
              >
                <span className="flex items-center gap-1.5">
                  <BookOpen className="size-3.5 text-emerald-400" aria-hidden />
                  Usar um modelo pronto ({SITUATION_TEMPLATES.length})
                </span>
                <ChevronDown className={cn("size-4 shrink-0 transition-transform", showTemplateGallery && "rotate-180")} aria-hidden />
              </button>
            ) : null}
            {!isMetaTransport && showTemplateGallery ? (
              <div className="mb-4 flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {SITUATION_TEMPLATES.map((tpl) => {
                  const Icon = tpl.Icon;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applySituationTemplate(tpl.body, tpl.title)}
                      className={cn(
                        "flex w-[min(100%,220px)] shrink-0 flex-col gap-2 rounded-xl border p-4 text-left transition-all",
                        "hover:border-primary/45 hover:border-line",
                        isLight ? "border-slate-200/90 bg-slate-50/80" : "border-line bg-surface-card/50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Icon className={cn("size-6 shrink-0", tpl.accent)} aria-hidden />
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Usar
                        </span>
                      </div>
                      <div>
                        <div className="font-semibold text-content">{tpl.title}</div>
                        <div className="mt-0.5 text-[11px] text-content-secondary">{tpl.subtitle}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {isMetaTransport ? (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-content-secondary">
                  Mensagens iniciadas pela empresa fora do horário de atendimento exigem um modelo já
                  aprovado pela Meta — texto livre não chega ao destinatário nesse caso. As variáveis
                  ({"{{1}}"} nome, {"{{2}}"} empresa, {"{{3}}"} telefone) são preenchidas automaticamente.
                </p>
                {connectionId && metaTemplates.length === 0 ? (
                  <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    Nenhum modelo aprovado encontrado pra essa linha ainda. Aprove um template no Gerenciador
                    da Meta e volte aqui.
                  </p>
                ) : (
                  <select
                    value={metaTemplateName}
                    onChange={(event) => setMetaTemplateName(event.target.value)}
                    className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                  >
                    <option value="">Selecione um modelo aprovado</option>
                    {metaTemplates.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
                {selectedMetaTemplate?.bodyText ? (
                  <p
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-xs leading-relaxed",
                      isLight ? "border-slate-200 bg-slate-50 text-content" : "border-line bg-surface-card/50 text-content",
                    )}
                  >
                    {selectedMetaTemplate.bodyText}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-content-secondary">Inserir variaveis no cursor:</p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {VARIABLES.map((v) => (
                    <button
                      key={v.snippet}
                      type="button"
                      onClick={() => appendVariable(v.snippet)}
                      className="rounded-full border border-line bg-surface-elevated/40 px-3 py-1 font-mono text-[11px] text-primary hover:border-primary/50 hover:bg-primary/10"
                    >
                      {v.snippet}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={taRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={4096}
                  rows={6}
                  className={cn(
                    "w-full resize-y rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20",
                    isLight ? "border-slate-200 bg-surface-card text-content" : "border-line bg-surface-card/50 text-content",
                  )}
                />
              </>
            )}

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="mt-4 flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface-card/40 px-3 py-2.5 text-left text-xs font-medium text-content-secondary transition-colors hover:border-primary/35 hover:text-content"
            >
              <span className="flex items-center gap-1.5">
                <Gauge className="size-3.5 text-primary" aria-hidden />
                Ritmo e agendamento — {scheduleSummary} · {throughputLabel}
              </span>
              <ChevronDown className={cn("size-4 shrink-0 transition-transform", showAdvanced && "rotate-180")} aria-hidden />
            </button>
            {showAdvanced ? (
              <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface-card/30 p-4">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-content-secondary">
                    <CalendarClock className="size-3.5" aria-hidden />
                    Janela de disparo
                  </label>
                  <Input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="rounded-xl" />
                  <p className="mt-1.5 text-[11px] text-content-secondary">Deixe em branco pra enviar agora mesmo.</p>
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-content-secondary">
                    <Gauge className="size-3.5" aria-hidden />
                    Ritmo de envio
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {THROUGHPUT.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setThroughput(t.id)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          throughput === t.id
                            ? "border-primary bg-primary text-white"
                            : "border-line text-content-secondary hover:border-primary/40 hover:text-content",
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-content-secondary">
                    {THROUGHPUT.find((t) => t.id === throughput)?.sub}
                  </p>
                </div>

                <div className="border-t border-line/60 pt-4">
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-content-secondary">
                    <CalendarClock className="size-3.5" aria-hidden />
                    Horários permitidos
                  </label>
                  <button
                    type="button"
                    onClick={() => setWindowActive((v) => !v)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-colors",
                      windowActive
                        ? "border-primary/60 bg-primary/10 text-content"
                        : "border-line bg-surface-card/40 text-content-secondary hover:border-primary/35",
                    )}
                  >
                    <span>
                      {windowActive
                        ? "Só envia dentro dos dias e horários escolhidos"
                        : "Envia a qualquer hora, todos os dias"}
                    </span>
                    <span className="text-[11px] font-medium text-primary">
                      {windowActive ? "Configurado" : "Definir"}
                    </span>
                  </button>

                  {windowActive ? (
                    <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface-deep/30 p-3">
                      <div>
                        <span className="mb-1.5 block text-[11px] font-medium text-content-secondary">
                          Dias da semana
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEK_DAYS.map((day) => {
                            const on = windowDays.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() =>
                                  setWindowDays((current) =>
                                    on
                                      ? current.filter((d) => d !== day.value)
                                      : [...current, day.value].sort((a, b) => a - b),
                                  )
                                }
                                className={cn(
                                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                                  on
                                    ? "border-primary bg-primary text-white"
                                    : "border-line text-content-secondary hover:border-primary/40",
                                )}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="mb-1 block text-[11px] font-medium text-content-secondary">
                            Começa às
                          </span>
                          <Input
                            type="time"
                            value={windowStart}
                            onChange={(e) => setWindowStart(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                        <div>
                          <span className="mb-1 block text-[11px] font-medium text-content-secondary">
                            Para às
                          </span>
                          <Input
                            type="time"
                            value={windowEnd}
                            onChange={(e) => setWindowEnd(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {riskWarning ? (
                  <div
                    className={cn(
                      "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed",
                      isLight
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-200",
                    )}
                    role="status"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{riskWarning}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                type="button"
                variant="gradient"
                className="gap-2"
                onClick={handleScheduleCampaign}
                isLoading={campaignBusy}
                disabled={!canSchedule}
              >
                <Zap className="size-4" aria-hidden />
                Agendar disparo
              </Button>
              {!isMetaTransport ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2"
                  onClick={handleSaveDraft}
                  isLoading={savingDraft}
                >
                  <Send className="size-4" aria-hidden />
                  Salvar rascunho
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-4 text-sm font-semibold text-content">Pre-visualizacao ao vivo</div>
            <div
              className={cn(
                "mx-auto max-w-sm overflow-hidden rounded-[2rem] border ",
                isLight ? "border-slate-300 bg-slate-900 text-slate-50" : "border-slate-700 bg-slate-950 text-slate-100",
              )}
            >
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <WhatsAppGlyph className="size-5 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">MyChatCRM · disparo</div>
                  <div className="text-[10px] text-emerald-300/90">online</div>
                </div>
                <span className="size-2 rounded-full bg-emerald-400 " aria-hidden />
              </div>
              <div className="space-y-2 bg-surface-deep px-3 py-4">
                <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-emerald-700/90 px-3 py-2 text-[13px] leading-snug text-white ">
                  {isMetaTransport
                    ? metaPreview || "Selecione um modelo…"
                    : preview || "Digite sua mensagem…"}
                </div>
                <div className="text-center text-[10px] text-white/40">Hoje · simulacao</div>
              </div>
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
