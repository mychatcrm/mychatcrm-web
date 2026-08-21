"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  Gauge,
  Layers,
  Trash2,
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
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import { CrmDestinationBlock } from "@/components/dashboard/agentes/CrmDestinationBlock";
import { WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import { SITUATION_TEMPLATES } from "@/components/dashboard/disparos/disparos-situation-templates";
import {
  buildAudienceBlocksPayload,
  createCrmBlock,
  DisparosPublicoBuilder,
  estimatePublicoTotal,
  hasUsablePublico,
  type PublicoBlock,
  type PublicoCrmPeriod,
  type PublicoCrmScope,
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

const OWNER_ACTIONS: Array<{ id: "manter" | "soltar" | "atribuir"; label: string; hint: string }> = [
  { id: "manter", label: "Manter vendedor atual", hint: "Não mexe em quem já é responsável" },
  { id: "atribuir", label: "Atribuir a um vendedor", hint: "Escolha quem fica responsável" },
  { id: "soltar", label: "Deixar sem vendedor", hint: "Sem dono até alguém puxar" },
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

type TeamEmployeeOption = {
  id: string;
  nome: string;
  ativo: boolean;
  accountSuspended: boolean;
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
  status: "draft" | "scheduled" | "processing" | "paused" | "completed" | "cancelled" | "failed";
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  scheduled_at: string | null;
  created_at: string;
  // Campos usados só ao reabrir a campanha pra editar.
  connection_id?: string | null;
  agent_id?: string | null;
  message_template?: string | null;
  meta_template_name?: string | null;
  throughput?: string | null;
  continue_with_agent?: boolean | null;
  audience_blocks?: Array<{ kind?: string; scope?: PublicoCrmScope; period?: PublicoCrmPeriod }> | null;
  send_window?: {
    ativo?: boolean;
    diasAtivos?: number[];
    horaInicio?: number;
    minutoInicio?: number;
    horaFim?: number;
    minutoFim?: number;
  } | null;
  lead_destination?: {
    moveToFunnel?: boolean;
    funnelId?: string | null;
    columnId?: string | null;
    ownerAction?: string;
    ownerEmployeeId?: string | null;
  } | null;
};

/** Numerozinho de passo — só orientação visual pro leigo saber onde está, sem afetar nada funcional. */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
      {n}
    </span>
  );
}

export function DisparosMassaHub() {
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
  // Vendedor responsável: "manter" preserva o comportamento de sempre.
  const [ownerAction, setOwnerAction] = useState<"manter" | "soltar" | "atribuir">("manter");
  const [ownerEmployeeId, setOwnerEmployeeId] = useState("");
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployeeOption[]>([]);
  // Depois do disparo: por padrão a IA continua atendendo quem responder —
  // igual ao comportamento de sempre.
  const [continueWithAgent, setContinueWithAgent] = useState(true);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  /** Id da campanha sendo editada — quando setado, salvar substitui em vez de criar outra. */
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [connections, setConnections] = useState<CampaignConnection[]>([]);
  const [agents, setAgents] = useState<CampaignAgent[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [eligibleRecipients, setEligibleRecipients] = useState(0);
  const [activeCampaignLimit, setActiveCampaignLimit] = useState(5);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [metaTemplateName, setMetaTemplateName] = useState("");
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const loadCampaignData = useCallback(async () => {
    try {
      const response = await fetch("/api/client/whatsapp-campaigns", { cache: "no-store" });
      const payload = (await response.json()) as {
        error?: string;
        campaigns?: CampaignRow[];
        connections?: CampaignConnection[];
        agents?: CampaignAgent[];
        eligibleRecipients?: number;
        activeCampaignLimit?: number;
      };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar campanhas.");
      setCampaigns(payload.campaigns ?? []);
      setConnections(payload.connections ?? []);
      setAgents(payload.agents ?? []);
      setEligibleRecipients(payload.eligibleRecipients ?? 0);
      setActiveCampaignLimit(typeof payload.activeCampaignLimit === "number" ? payload.activeCampaignLimit : 5);
      setConnectionId((current) => current || payload.connections?.[0]?.connectionId || "");
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Não foi possível carregar campanhas.");
    }
  }, []);

  const loadTeamEmployees = useCallback(async () => {
    try {
      const response = await fetch("/api/team-employees", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { employees?: TeamEmployeeOption[] };
      setTeamEmployees(payload.employees ?? []);
    } catch {
      // Silencioso: sem a lista, "atribuir a um vendedor" só fica sem opções.
    }
  }, []);

  useEffect(() => {
    void loadCampaignData();
    void loadTeamEmployees();
  }, [loadCampaignData, loadTeamEmployees]);

  // `campaignsRef` existe só pra o loop de envio abaixo ler o status mais
  // recente sem precisar recriar a função a cada mudança de `campaigns`.
  const campaignsRef = useRef<CampaignRow[]>(campaigns);
  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);

  const activeCampaignIdsKey = useMemo(
    () =>
      campaigns
        .filter((c) => c.status === "scheduled" || c.status === "processing")
        .map((c) => c.id)
        .join(","),
    [campaigns],
  );

  /**
   * Sem isto, um disparo só andava de novo quando alguém apertava play/pause
   * de novo, ou no cron diário (`/api/internal/process-omnichannel`, uma vez
   * por dia) — na prática o envio TRAVAVA depois da primeira leva, e a barra
   * de progresso do card ficava parada por até 24h. Enquanto a tela de
   * Disparos estiver aberta, chama a rota de processar em sequência — assim
   * que uma passada volta, chama de novo — pra qualquer disparo em fila ou
   * enviando. Reclamar um destinatário já é atômico no servidor
   * (`processRecipient`), então duas passadas se cruzando nunca manda a
   * mesma mensagem duas vezes.
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const drivingCampaignIdsRef = useRef<Set<string>>(new Set());
  const driveCampaignSending = useCallback(
    async (campaignId: string) => {
      try {
        while (isMountedRef.current) {
          const stillActive = campaignsRef.current.some(
            (c) => c.id === campaignId && (c.status === "scheduled" || c.status === "processing"),
          );
          if (!stillActive) break;

          let processedCount = 0;
          try {
            const response = await fetch(
              `/api/client/whatsapp-campaigns/${encodeURIComponent(campaignId)}/process`,
              { method: "POST" },
            );
            if (response.ok) {
              const payload = (await response.json().catch(() => ({}))) as { processed?: number };
              processedCount = typeof payload.processed === "number" ? payload.processed : 0;
            }
          } catch {
            // Falha de rede nesta passada — tenta de novo no próximo ciclo,
            // sem assustar quem só está olhando a tela.
          }

          if (!isMountedRef.current) break;
          await loadCampaignData();

          // Nada processado agora (ex.: destinatário com retry agendado pra
          // daqui a pouco) — espera um instante antes de tentar de novo, pra
          // não martelar o servidor sem parar.
          if (processedCount === 0) await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
      } finally {
        drivingCampaignIdsRef.current.delete(campaignId);
      }
    },
    [loadCampaignData],
  );

  useEffect(() => {
    if (!activeCampaignIdsKey) return;
    for (const id of activeCampaignIdsKey.split(",")) {
      if (drivingCampaignIdsRef.current.has(id)) continue;
      drivingCampaignIdsRef.current.add(id);
      void driveCampaignSending(id);
    }
  }, [activeCampaignIdsKey, driveCampaignSending]);

  // Atualiza a porcentagem do card em tempo real enquanto algo está ativo —
  // inclusive quando quem está enviando é outra aba ou o próprio servidor,
  // não só o loop acima.
  useEffect(() => {
    if (!activeCampaignIdsKey) return;
    const timer = window.setInterval(() => void loadCampaignData(), 2500);
    return () => window.clearInterval(timer);
  }, [activeCampaignIdsKey, loadCampaignData]);

  const activeTeamEmployees = useMemo(
    () => teamEmployees.filter((employee) => employee.ativo && !employee.accountSuspended),
    [teamEmployees],
  );

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

  const notify = useCallback((message: string) => {
    setDraftNotice(message);
    window.setTimeout(() => setDraftNotice(null), 4000);
  }, []);

  /** Volta o formulário aos padrões — usado ao abrir "Criar disparo" pra não herdar sobra de uma edição anterior. */
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
    setAgentId("");
    setOwnerAction("manter");
    setOwnerEmployeeId("");
    setContinueWithAgent(true);
    setMetaTemplateName("");
    setShowTemplateGallery(false);
    setShowAdvanced(false);
    setCampaignError(null);
  }, []);

  const handleCreateNew = useCallback(() => {
    resetCampaignForm();
    setEditingCampaignId(null);
    setDraftNotice(null);
    setView("create");
  }, [resetCampaignForm]);

  /**
   * Editar carrega a campanha salva de volta no mesmo formulário de criação.
   * O público volta só nos blocos de CRM: os blocos de contatos já viraram
   * leads reais no momento da importação, e `audience_blocks` guarda só os
   * ids deles — reidratar isso como "lista importada" daria a impressão falsa
   * de que o arquivo original está ali pra editar.
   */
  const handleEditCampaign = useCallback(
    (campaignId: string) => {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) return;
      resetCampaignForm();
      setEditingCampaignId(campaignId);
      setCampaignName(campaign.name);
      setConnectionId(campaign.connection_id ?? "");
      setAgentId(campaign.agent_id ?? "");
      setBody(campaign.message_template ?? DEFAULT_MESSAGE);
      setThroughput(
        campaign.throughput === "suave" || campaign.throughput === "acelerado" ? campaign.throughput : "normal",
      );
      setMetaTemplateName(campaign.meta_template_name ?? "");

      const crmBlocks = (campaign.audience_blocks ?? [])
        .filter((block): block is { kind: "crm"; scope: PublicoCrmScope; period: PublicoCrmPeriod } => block?.kind === "crm")
        .map((block) => ({
          ...createCrmBlock(),
          // Reconstruindo a partir do que foi salvo: aqui, sim, o escopo
          // vazio significa "Todos os funis" — é o próprio contrato de
          // gravação. Diferente do clique na tela, onde vazio pode ser só um
          // estado transitório de quem está montando a seleção.
          scopeMode:
            block.scope.funnelIds.length > 0 || block.scope.columns.length > 0
              ? ("custom" as const)
              : ("all" as const),
          scope: block.scope,
          period: block.period,
        }));
      setPublicoBlocks(crmBlocks.length > 0 ? crmBlocks : [createCrmBlock()]);

      const janela = campaign.send_window;
      if (janela?.ativo) {
        setWindowActive(true);
        setWindowDays(Array.isArray(janela.diasAtivos) ? janela.diasAtivos : [1, 2, 3, 4, 5]);
        setWindowStart(
          `${String(janela.horaInicio ?? 9).padStart(2, "0")}:${String(janela.minutoInicio ?? 0).padStart(2, "0")}`,
        );
        setWindowEnd(
          `${String(janela.horaFim ?? 18).padStart(2, "0")}:${String(janela.minutoFim ?? 0).padStart(2, "0")}`,
        );
        setShowAdvanced(true);
      }

      const destino = campaign.lead_destination;
      if (destino?.moveToFunnel && destino.funnelId && destino.columnId) {
        setDestMoveEnabled(true);
        setDestFunnelId(destino.funnelId);
        setDestColumnId(destino.columnId);
      }
      if (destino?.ownerAction === "soltar" || destino?.ownerAction === "atribuir") {
        setOwnerAction(destino.ownerAction);
        setOwnerEmployeeId(destino.ownerEmployeeId ?? "");
      }
      setContinueWithAgent(campaign.continue_with_agent !== false);

      setDraftNotice(null);
      setView("create");
    },
    [campaigns, resetCampaignForm],
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
        status: campaign.status,
        totalRecipients: campaign.total_recipients ?? 0,
        totalSent: campaign.total_sent ?? 0,
        totalFailed: campaign.total_failed ?? 0,
        scheduledLabel: `${(campaign.total_recipients ?? 0).toLocaleString("pt-BR")} contatos`,
      })),
    [campaigns],
  );

  // Mesma contagem que o servidor usa pro teto: só o que ainda não terminou
  // ocupa vaga. Concluída/cancelada/falhou libera espaço pra outra.
  const activeCampaignCount = useMemo(
    () => campaigns.filter((c) => c.status === "scheduled" || c.status === "processing").length,
    [campaigns],
  );

  const canSchedule =
    Boolean(connectionId) &&
    Boolean(campaignName.trim()) &&
    Boolean(agentId) &&
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
          agentId,
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
            ownerAction,
            ownerEmployeeId: ownerAction === "atribuir" ? ownerEmployeeId || null : null,
          },
          continueWithAgent,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar o disparo.");
      // Editar é recriar: o card só é editável enquanto nada foi enviado, e aí
      // recriar é equivalente a alterar — sem o risco de mexer no público de
      // uma campanha com fila em andamento. O antigo sai depois que o novo já
      // existe, pra uma falha aqui nunca perder a configuração.
      if (editingCampaignId) {
        await fetch(`/api/client/whatsapp-campaigns/${encodeURIComponent(editingCampaignId)}`, { method: "DELETE" });
      }
      // Salvar não dispara: o card nasce parado esperando o play.
      notify(editingCampaignId ? "Disparo atualizado." : "Disparo salvo. Dê play no card quando quiser começar.");
      await loadCampaignData();
      setEditingCampaignId(null);
      setView("list");
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Não foi possível salvar o disparo.");
    } finally {
      setCampaignBusy(false);
    }
  }, [
    notify,
    agentId,
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
    ownerAction,
    ownerEmployeeId,
    continueWithAgent,
    editingCampaignId,
  ]);

  const handleDeleteCampaign = useCallback(
    async (campaignId: string) => {
      setBusyCampaignId(campaignId);
      try {
        const response = await fetch(`/api/client/whatsapp-campaigns/${encodeURIComponent(campaignId)}`, {
          method: "DELETE",
        });
        if (response.ok) {
          notify("Disparo excluído.");
          await loadCampaignData();
        }
      } finally {
        setBusyCampaignId(null);
      }
    },
    [loadCampaignData, notify],
  );

  /** Play, pause e começar do zero — todos passam pela mesma rota de controle. */
  const handleControl = useCallback(
    async (campaignId: string, action: "start" | "pause" | "reset") => {
      setBusyCampaignId(campaignId);
      setCampaignError(null);
      try {
        const response = await fetch(
          `/api/client/whatsapp-campaigns/${encodeURIComponent(campaignId)}/control`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível executar a ação.");
        notify(
          action === "start"
            ? "Disparo iniciado."
            : action === "pause"
              ? "Disparo pausado — o play retoma de onde parou."
              : "Disparo voltou do zero.",
        );
        await loadCampaignData();
      } catch (error) {
        setCampaignError(error instanceof Error ? error.message : "Não foi possível executar a ação.");
      } finally {
        setBusyCampaignId(null);
      }
    },
    [loadCampaignData, notify],
  );

  /**
   * Ordem nova aplicada na hora e persistida em segundo plano: arrastar tem
   * que responder na hora, e se a gravação falhar a próxima carga devolve a
   * ordem antiga — nada se perde.
   */
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      setCampaigns((current) => {
        const byId = new Map(current.map((c) => [c.id, c]));
        return orderedIds.map((id) => byId.get(id)).filter((c): c is CampaignRow => Boolean(c));
      });
      void fetch("/api/client/whatsapp-campaigns/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      }).catch(() => undefined);
    },
    [],
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
          busyCampaignId={busyCampaignId}
          activeCampaignCount={activeCampaignCount}
          activeCampaignLimit={activeCampaignLimit}
          onCreateNew={handleCreateNew}
          onReorder={handleReorder}
          onStart={(id) => void handleControl(id, "start")}
          onPause={(id) => void handleControl(id, "pause")}
          onReset={(id) => void handleControl(id, "reset")}
          onEdit={handleEditCampaign}
          onDelete={(id) => void handleDeleteCampaign(id)}
        />
      ) : (
        <>
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
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
            >
              <option value="">Selecione um agente</option>
              {agents.map((agent) => (
                <option key={agent.agent_id} value={agent.agent_id}>
                  {agent.display_name || agent.agent_id}
                </option>
              ))}
            </select>
            {agents.length === 0 ? (
              <p className="mt-2 text-[11px] text-content-secondary">
                Nenhum agente ativo ainda — crie um em Meus Agentes antes de agendar um disparo.
              </p>
            ) : null}
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
              Quem responder ao disparo passa a ser atendido pelo agente escolhido acima automaticamente — isso não
              é opcional. As opções abaixo controlam só o funil/coluna e o vendedor responsável no CRM.
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
            <div className="mt-3">
              <span className="mb-1.5 block text-[11px] font-medium text-content-secondary">
                Vendedor responsável
              </span>
              <div className="grid gap-2 sm:grid-cols-3">
                {OWNER_ACTIONS.map((opt) => {
                  const active = opt.id === ownerAction;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setOwnerAction(opt.id);
                        if (opt.id === "atribuir" && !ownerEmployeeId) {
                          setOwnerEmployeeId(activeTeamEmployees[0]?.id ?? "");
                        }
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left text-xs transition-all",
                        active
                          ? "border-primary/60 bg-primary/10"
                          : "border-line bg-surface-card/40 hover:border-primary/35 hover:bg-surface-elevated/30",
                      )}
                    >
                      <div className="font-semibold text-content">{opt.label}</div>
                      <div className="mt-0.5 text-[10px] text-content-secondary">{opt.hint}</div>
                    </button>
                  );
                })}
              </div>
              {ownerAction === "atribuir" ? (
                activeTeamEmployees.length > 0 ? (
                  <select
                    value={ownerEmployeeId}
                    onChange={(event) => setOwnerEmployeeId(event.target.value)}
                    className="mt-2.5 h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                  >
                    {activeTeamEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.nome}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Nenhum vendedor ativo encontrado na equipe.
                  </p>
                )
              ) : null}
            </div>

            <div className="mt-4 border-t border-line/60 pt-4">
              <span className="mb-1.5 block text-[11px] font-medium text-content-secondary">
                Depois do disparo
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setContinueWithAgent(true)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-xs transition-all",
                    continueWithAgent
                      ? "border-primary/60 bg-primary/10"
                      : "border-line bg-surface-card/40 hover:border-primary/35 hover:bg-surface-elevated/30",
                  )}
                >
                  <div className="font-semibold text-content">IA continua atendendo</div>
                  <div className="mt-0.5 text-[10px] text-content-secondary">
                    Quem responder é conduzido pelo agente escolhido acima
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setContinueWithAgent(false)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-xs transition-all",
                    !continueWithAgent
                      ? "border-primary/60 bg-primary/10"
                      : "border-line bg-surface-card/40 hover:border-primary/35 hover:bg-surface-elevated/30",
                  )}
                >
                  <div className="font-semibold text-content">Só essa mensagem</div>
                  <div className="mt-0.5 text-[10px] text-content-secondary">
                    Não continua a conversa — um humano assume as respostas
                  </div>
                </button>
              </div>
            </div>
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

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="gradient"
                className="gap-2"
                onClick={handleScheduleCampaign}
                isLoading={campaignBusy}
                disabled={!canSchedule}
              >
                <Check className="size-4" aria-hidden />
                Salvar
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                onClick={() => {
                  resetCampaignForm();
                  setEditingCampaignId(null);
                  setView("list");
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Excluir
              </Button>
              <span className="text-[11px] text-content-secondary">
                Salvar não começa a enviar — o disparo vira um card e você dá play quando quiser.
              </span>
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
