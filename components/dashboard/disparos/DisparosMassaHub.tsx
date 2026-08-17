"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  Gauge,
  Layers,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import {
  loadDisparosDrafts,
  persistDisparosDrafts,
  type DisparosDraft,
} from "@/components/dashboard/disparos/disparos-drafts-storage";
import { SITUATION_TEMPLATES } from "@/components/dashboard/disparos/disparos-situation-templates";

const DEFAULT_MESSAGE =
  "Ola {{nome}}, preparamos uma condicao especial para {{empresa}}. Responda SIM para receber o link seguro.";

const AUDIENCE = [
  { id: "todos" as const, label: "Base completa", hint: "Todos os leads com opt-in" },
  { id: "tag" as const, label: "Por tag", hint: "Segmentos do CRM Kanban" },
  { id: "etapa" as const, label: "Por funil", hint: "Colunas do CRM Kanban" },
];

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

type AudiencePreview = { totalMatched: number; optedIn: number; notOptedIn: number };

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

export function DisparosMassaHub() {
  const { isLight } = usePanelAppearance();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [campaignName, setCampaignName] = useState("");
  const [audienceId, setAudienceId] = useState<(typeof AUDIENCE)[number]["id"]>("todos");
  const [schedule, setSchedule] = useState("");
  const [body, setBody] = useState(DEFAULT_MESSAGE);
  const [throughput, setThroughput] = useState<(typeof THROUGHPUT)[number]["id"]>("normal");
  // Janela de envio: desligada por padrão mantém o comportamento de sempre
  // (envia a qualquer hora). Ligada, só envia nos dias e horários escolhidos.
  const [windowActive, setWindowActive] = useState(false);
  const [windowDays, setWindowDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [drafts, setDrafts] = useState<DisparosDraft[]>([]);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [connections, setConnections] = useState<CampaignConnection[]>([]);
  const [agents, setAgents] = useState<CampaignAgent[]>([]);
  const [disparosAgent, setDisparosAgent] = useState<{ agentId: string; displayName: string } | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [agentMode, setAgentMode] = useState<"existing" | "disparos">("existing");
  const [agentId, setAgentId] = useState("");
  const [audienceValue, setAudienceValue] = useState("");
  const [eligibleRecipients, setEligibleRecipients] = useState(0);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [audiencePreview, setAudiencePreview] = useState<AudiencePreview | null>(null);
  const [audiencePreviewLoading, setAudiencePreviewLoading] = useState(false);
  const [optInBusy, setOptInBusy] = useState(false);
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [metaTemplateName, setMetaTemplateName] = useState("");
  const [processingCampaignId, setProcessingCampaignId] = useState<string | null>(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importOptIn, setImportOptIn] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

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
        disparosAgent?: { agentId: string; displayName: string } | null;
      };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar campanhas.");
      setCampaigns(payload.campaigns ?? []);
      setConnections(payload.connections ?? []);
      setAgents(payload.agents ?? []);
      setEligibleRecipients(payload.eligibleRecipients ?? 0);
      setDisparosAgent(payload.disparosAgent ?? null);
      setConnectionId((current) => current || payload.connections?.[0]?.connectionId || "");
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Não foi possível carregar campanhas.");
    }
  }, []);

  useEffect(() => {
    void loadCampaignData();
  }, [loadCampaignData]);

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

  const audienceApiType = audienceId === "etapa" ? "funnel_stage" : audienceId === "todos" ? "all" : "tag";

  const refreshAudiencePreview = useCallback(() => {
    if (audienceApiType !== "all" && !audienceValue.trim()) {
      setAudiencePreview(null);
      return;
    }
    setAudiencePreviewLoading(true);
    const qs = new URLSearchParams({ type: audienceApiType, ...(audienceValue.trim() ? { value: audienceValue.trim() } : {}) });
    fetch(`/api/client/whatsapp-campaigns/audience-preview?${qs.toString()}`)
      .then((r) => r.json())
      .then((data: AudiencePreview) => setAudiencePreview(data))
      .catch(() => setAudiencePreview(null))
      .finally(() => setAudiencePreviewLoading(false));
  }, [audienceApiType, audienceValue]);

  useEffect(() => {
    const timer = window.setTimeout(refreshAudiencePreview, 350);
    return () => window.clearTimeout(timer);
  }, [refreshAudiencePreview]);

  const handleImport = useCallback(async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/client/whatsapp-campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: importText, optIn: importOptIn }),
      });
      const payload = (await res.json()) as {
        error?: string;
        created?: number;
        reused?: number;
        optedInCount?: number;
        duplicatesInFile?: number;
        invalidCount?: number;
        truncated?: boolean;
      };
      if (!res.ok) throw new Error(payload.error ?? "Não foi possível importar a lista.");

      // Relato completo de propósito: importação silenciosa esconde linha
      // descartada, e o cliente só descobre quando o disparo não alcança quem
      // ele esperava.
      const partes = [`${payload.created ?? 0} contato(s) novo(s)`];
      if (payload.reused) partes.push(`${payload.reused} já existia(m) no CRM`);
      if (payload.optedInCount) partes.push(`${payload.optedInCount} autorizado(s)`);
      if (payload.duplicatesInFile) partes.push(`${payload.duplicatesInFile} repetido(s) na lista`);
      if (payload.invalidCount) partes.push(`${payload.invalidCount} linha(s) inválida(s)`);
      if (payload.truncated) partes.push("lista cortada no limite de 5.000");
      setImportResult(`${partes.join(" · ")}.`);
      setImportText("");
      await loadCampaignData();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Falha ao importar.");
    } finally {
      setImportBusy(false);
    }
  }, [importText, importOptIn, loadCampaignData]);

  const handleBulkOptIn = useCallback(async () => {
    setOptInBusy(true);
    setCampaignError(null);
    try {
      const res = await fetch("/api/client/whatsapp-campaigns/audience-opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceType: audienceApiType,
          audienceValue: audienceApiType === "all" ? null : audienceValue.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string; optedInCount?: number };
      if (!res.ok) throw new Error(data.error ?? "Erro ao autorizar leads.");
      setDraftNotice(
        data.optedInCount
          ? `${data.optedInCount} lead(s) autorizado(s) a receber WhatsApp.`
          : "Todos os leads deste público já estavam autorizados.",
      );
      window.setTimeout(() => setDraftNotice(null), 4000);
      refreshAudiencePreview();
      await loadCampaignData();
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Erro ao autorizar leads.");
    } finally {
      setOptInBusy(false);
    }
  }, [audienceApiType, audienceValue, loadCampaignData, refreshAudiencePreview]);

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
    const total = audiencePreview?.optedIn ?? eligibleRecipients;
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
  }, [throughput, windowActive, windowStart, windowEnd, windowDays, audiencePreview, eligibleRecipients]);
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
    const draft: DisparosDraft = {
      id: newDraftId(),
      name,
      audienceId,
      schedule,
      throughput,
      body,
      updatedAt: new Date().toISOString(),
    };
    commitDrafts((prev) => [draft, ...prev]);
    setDraftNotice("Rascunho salvo neste navegador (local).");
    window.setTimeout(() => setDraftNotice(null), 4500);
    window.setTimeout(() => setSavingDraft(false), 400);
  }, [audienceId, body, campaignName, commitDrafts, schedule, throughput]);

  const handleLoadDraft = useCallback((d: DisparosDraft) => {
    setCampaignName(d.name);
    setAudienceId(d.audienceId);
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

  const statusLabel = (status: CampaignRow["status"]) => {
    if (status === "completed") return "Concluída";
    if (status === "scheduled") return "Agendada";
    if (status === "processing") return "Processando";
    if (status === "cancelled") return "Cancelada";
    if (status === "failed") return "Falhou";
    return "Rascunho";
  };

  const canSchedule =
    Boolean(connectionId) &&
    Boolean(campaignName.trim()) &&
    (agentMode === "disparos" || Boolean(agentId)) &&
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
          agentId: agentMode === "existing" ? agentId : undefined,
          audienceType: audienceApiType,
          audienceValue: audienceId === "todos" ? null : audienceValue,
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
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível agendar a campanha.");
      setDraftNotice("Campanha criada — os primeiros envios já começaram.");
      await loadCampaignData();
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Não foi possível agendar a campanha.");
    } finally {
      setCampaignBusy(false);
    }
  }, [
    agentId,
    agentMode,
    audienceApiType,
    audienceId,
    audienceValue,
    body,
    campaignName,
    connectionId,
    isMetaTransport,
    loadCampaignData,
    metaTemplateName,
    schedule,
    selectedMetaTemplate,
    throughput,
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
              Disparo em massa
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
                onClick={() => setAgentMode("disparos")}
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
                  {disparosAgent ? "Já configurado — reaproveita o mesmo" : "Criado automaticamente na primeira vez"}
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
              <p className="mt-3 text-[11px] text-content-secondary">
                Esse agente aparece em Agentes como qualquer outro — você pode ajustar o texto dele lá se quiser.
              </p>
            )}
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
            <div className="grid gap-2 sm:grid-cols-3">
              {AUDIENCE.map((opt) => {
                const active = opt.id === audienceId;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAudienceId(opt.id)}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left text-sm transition-all",
                      active
                        ? "border-primary/60 bg-primary/10 "
                        : "border-line bg-surface-card/40 hover:border-primary/35 hover:bg-surface-elevated/30",
                    )}
                  >
                    <div className="font-semibold text-content">{opt.label}</div>
                    <div className="mt-0.5 text-[11px] text-content-secondary">{opt.hint}</div>
                  </button>
                );
              })}
            </div>
            {audienceId !== "todos" ? (
              <Input
                value={audienceValue}
                onChange={(event) => setAudienceValue(event.target.value)}
                placeholder={audienceId === "tag" ? "Tag exata do lead" : "ID da etapa do funil"}
                className="mt-3 rounded-xl"
              />
            ) : null}
            <div
              className={cn(
                "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5",
                isLight ? "border-slate-200/80 bg-slate-50/60" : "border-line/70 bg-surface-card/30",
              )}
            >
              <div className="text-xs text-content-secondary">
                {audiencePreviewLoading ? (
                  "Contando leads…"
                ) : audiencePreview ? (
                  <>
                    <strong className="text-content">{audiencePreview.totalMatched}</strong> lead(s) neste público ·{" "}
                    <strong className="text-emerald-500">{audiencePreview.optedIn}</strong> já autorizado(s)
                    {audiencePreview.notOptedIn > 0 ? (
                      <>
                        {" "}
                        · <strong className="text-amber-500">{audiencePreview.notOptedIn}</strong> sem autorização ainda
                      </>
                    ) : null}
                  </>
                ) : (
                  "Digite o valor do público pra ver a contagem."
                )}
              </div>
              {audiencePreview && audiencePreview.notOptedIn > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={handleBulkOptIn} isLoading={optInBusy}>
                  Autorizar todos esses leads
                </Button>
              ) : null}
            </div>

            <div className="mt-4 border-t border-line/60 pt-4">
              <button
                type="button"
                onClick={() => setShowImport((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-medium text-content-secondary transition-colors hover:text-content"
              >
                <span className="flex items-center gap-1.5">
                  <Upload className="size-3.5 text-primary" aria-hidden />
                  Importar lista de fora do CRM
                </span>
                <ChevronDown
                  className={cn("size-4 shrink-0 transition-transform", showImport && "rotate-180")}
                  aria-hidden
                />
              </button>

              {showImport ? (
                <div className="mt-3 space-y-3">
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={"nome,telefone\nMaria Silva,5562991234567\nJoão Souza,(62) 99765-4321"}
                    className="min-h-[120px] w-full resize-y rounded-xl border border-line bg-surface-card/40 px-3 py-2.5 font-mono text-xs text-content outline-none"
                  />
                  <p className="text-[11px] leading-relaxed text-content-secondary">
                    Cole do Excel ou de um CSV. Aceita vírgula ou ponto e vírgula, com ou sem
                    cabeçalho. Contato que já existe no CRM é reaproveitado, não duplicado.
                  </p>

                  <label className="flex items-start gap-2 text-[11px] leading-relaxed text-content-secondary">
                    <input
                      type="checkbox"
                      checked={importOptIn}
                      onChange={(e) => setImportOptIn(e.target.checked)}
                      className="mt-0.5 size-3.5 shrink-0 accent-primary"
                    />
                    <span>
                      Marcar estes contatos como autorizados a receber WhatsApp. Só marque se você
                      realmente tem o consentimento — disparo para quem não pediu é o caminho mais
                      rápido para o número ser bloqueado.
                    </span>
                  </label>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleImport}
                    isLoading={importBusy}
                    disabled={!importText.trim()}
                  >
                    Importar contatos
                  </Button>

                  {importResult ? (
                    <div
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed",
                        isLight
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
                      )}
                      role="status"
                    >
                      {importResult}
                    </div>
                  ) : null}
                  {importError ? (
                    <div
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed",
                        isLight
                          ? "border-red-200 bg-red-50 text-red-900"
                          : "border-red-500/30 bg-red-500/10 text-red-200",
                      )}
                      role="alert"
                    >
                      {importError}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
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

            {draftNotice ? (
              <div
                className={cn(
                  "mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium",
                  isLight ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
                )}
                role="status"
              >
                <Check className="size-4 shrink-0 text-emerald-500" aria-hidden />
                {draftNotice}
              </div>
            ) : null}
            {campaignError ? (
              <div className="mt-3 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-500" role="alert">
                {campaignError}
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
            {!isMetaTransport && drafts.length > 0 ? (
              <div className="mt-6 border-t border-line pt-5">
                <button
                  type="button"
                  onClick={() => setShowDrafts((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                    Meus rascunhos ({drafts.length})
                  </span>
                  <ChevronDown className={cn("size-4 shrink-0 text-content-secondary transition-transform", showDrafts && "rotate-180")} aria-hidden />
                </button>
                {showDrafts ? (
                  <ul className="mt-3 max-h-[220px] space-y-2 overflow-y-auto pr-1">
                    {drafts.map((d) => {
                      const when = new Date(d.updatedAt).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      });
                      return (
                        <li
                          key={d.id}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border px-3 py-2.5",
                            isLight ? "border-slate-200/90 bg-surface-card" : "border-line/80 bg-surface-card/40",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-content">{d.name}</div>
                            <div className="text-[10px] text-content-secondary">{when}</div>
                          </div>
                          <Button type="button" variant="ghost" size="sm" className="shrink-0 px-3" onClick={() => handleLoadDraft(d)}>
                            Carregar
                          </Button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDraft(d.id)}
                            className={cn(
                              "grid size-10 shrink-0 place-items-center rounded-xl border border-transparent text-content-secondary transition-colors",
                              isLight ? "hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600" : "hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300",
                            )}
                            aria-label={`Excluir rascunho ${d.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
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

          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-content">Historico de campanhas</span>
              <Badge className="text-[10px]">Dados persistidos</Badge>
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-content-secondary">
                Nenhuma campanha persistida ainda. Campanhas só aceitam leads com opt-in ativo.
              </p>
            ) : <ul className="space-y-3">
              {history.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    "flex items-center gap-4 rounded-xl border px-4 py-3",
                    isLight ? "border-slate-200/80 bg-slate-50/80" : "border-line/80 bg-surface-card/40",
                  )}
                >
                  <div className="relative size-12 shrink-0">
                    <div
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: `conic-gradient(rgb(34 197 94) ${row.delivered * 3.6}deg, rgba(148,163,184,0.28) 0)`,
                      }}
                      aria-hidden
                    />
                    <div
                      className={cn(
                        "absolute inset-[3px] grid place-items-center rounded-[0.65rem] text-[11px] font-bold tabular-nums",
                        isLight ? "bg-surface-deep text-content" : "bg-slate-950 text-slate-100",
                      )}
                    >
                      {row.delivered}%
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-content">{row.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-content-secondary">
                      <span>{statusLabel(row.status)}</span>
                      <span className="text-content-secondary/50">·</span>
                      <span>{row.window}</span>
                    </div>
                  </div>
                  {row.status === "processing" ? (
                    <button
                      type="button"
                      onClick={() => void handleProcessNow(row.id)}
                      disabled={processingCampaignId === row.id}
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-content-secondary transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      aria-label={`Enviar próximo lote agora — ${row.name}`}
                      title="Enviar próximo lote agora"
                    >
                      <RefreshCw className={cn("size-4", processingCampaignId === row.id && "animate-spin")} aria-hidden />
                    </button>
                  ) : null}
                  {["draft", "scheduled", "processing"].includes(row.status) ? (
                    <button
                      type="button"
                      onClick={() => void handleCancelCampaign(row.id)}
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-content-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                      aria-label={`Cancelar campanha ${row.name}`}
                    >
                      <Square className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>}
          </div>
        </div>
      </div>
    </div>
  );
}
