"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  FileText,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Share2,
  User,
} from "lucide-react";
import { WhatsAppGlyph, WhatsAppQrMark } from "@/components/dashboard/crm/crm-phone";
import { PanelAppearancePortalBridge, usePanelAppearance } from "@/components/panel/PanelAppearance";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelHelp, type PanelHelpContent } from "@/components/panel/ui/PanelHelp";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/types";
import type { MetaStatusPage } from "@/app/api/client/meta/status/route";
import type { MetaFormsForm } from "@/app/api/client/meta/forms/route";
import type { MetaFormField } from "@/app/api/client/meta/form-fields/route";
import {
  ORGANIC_WHATSAPP_SOURCE,
  distributionLabel,
  sourceLabel,
  type LeadDistributionRule,
  type LeadDistributionType,
  type LeadFieldMapping,
  type LeadRuleSource,
} from "@/lib/lead-distribution-rules";
import {
  buildLeadRuleMappingsFromFields,
  buildLeadRuleMappingsFromMetaFormGroups,
  computeFormMappingHealth,
  mappingLookupKey,
  normalizeLeadFieldText,
  type MetaFormFieldGroup,
} from "@/lib/lead-rule-field-mapping";
import { refreshTeamEmployeesFromApi } from "@/lib/team-employees-client-cache";
import {
  MAX_ORG_DIRECTORS,
  MAX_ORG_MANAGERS,
  MAX_ORG_SELLERS,
  MAX_TEAM_EMPLOYEES,
} from "@/lib/team-employees-types";
import { loadTeamEmployees, TEAM_EMPLOYEES_UPDATED_EVENT } from "@/lib/team-employees-storage";
import { typography } from "@/lib/typography";

const STEPS = ["Entrada", "Mapeamento", "Distribuição", "Resumo"] as const;

const DISTRIBUTION_HELP = {
  type: {
    title: "Tipo de distribuição",
    summary: "Define o que acontece com o lead assim que esta regra for acionada.",
    items: [
      "CRM apenas: salva o lead sem iniciar atendimento automático.",
      "Equipe humana: encaminha para os colaboradores selecionados.",
      "Agente de IA: autoriza somente o agente escolhido a iniciar o atendimento.",
    ],
  },
  policy: {
    title: "Política de conflitos",
    summary: "Decide qual jornada fica ativa quando o mesmo telefone entra por outra campanha ou formulário.",
    items: [
      "Mais recente: a nova campanha assume o atendimento.",
      "Maior prioridade: vence a regra posicionada acima das demais.",
      "Até inatividade: mantém o atendimento atual pelo tempo configurado.",
      "Decisão humana: pausa a automação para a equipe escolher.",
    ],
  },
  inactivity: {
    title: "Tempo de inatividade",
    summary: "Período sem novas mensagens necessário para outra jornada assumir o contato.",
    example: "Com 30 minutos, a jornada atual permanece responsável até passar meia hora sem interação.",
  },
  redistribution: {
    title: "Redistribuição",
    summary: "Permite tentar outro destino quando o atendimento inicial não consegue avançar.",
    items: [
      "Só ocorre nos gatilhos marcados abaixo.",
      "Nunca autoriza um agente que esteja fora desta regra.",
      "Desativada, o lead permanece no destino inicialmente escolhido.",
    ],
  },
  deadline: {
    title: "Prazo da tentativa",
    summary: "Tempo aguardado antes de considerar o destino atual sem avanço e avaliar uma redistribuição.",
  },
  attempts: {
    title: "Quantidade de tentativas",
    summary: "Limita quantas redistribuições podem ocorrer para o mesmo lead nesta regra.",
  },
  redistributionType: {
    title: "Tipo de redistribuição",
    summary: "Escolhe a estratégia usada para encontrar o próximo destino autorizado.",
  },
  triggers: {
    title: "Quando redistribuir",
    summary: "A redistribuição só é considerada quando pelo menos uma destas situações marcadas acontecer.",
    items: [
      "Agente indisponível: o agente está pausado ou não pode atender.",
      "Falha no envio: a mensagem não foi entregue após as tentativas.",
      "Equipe sem aceite: ninguém assumiu dentro do prazo.",
      "Silêncio do cliente: transfere a jornada antes do próximo acompanhamento.",
    ],
  },
  finalDestination: {
    title: "Destino final",
    summary: "Define o que fazer quando as tentativas de redistribuição terminarem sem sucesso.",
    items: [
      "Próximo agente: tenta outro agente já autorizado nesta regra.",
      "Equipe humana: deixa o atendimento para os colaboradores.",
      "Somente CRM: mantém o lead registrado sem nova automação.",
    ],
  },
} satisfies Record<string, PanelHelpContent>;

/** Logótipo Facebook (círculo “f” oficial, cor de marca Meta #1877F2). */
function FacebookMark({ className }: { className?: string }) {
  return (
    <svg className={cn(className)} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </svg>
  );
}

function normalizeFormSearchText(value: string): string {
  return normalizeLeadFieldText(value);
}

const CRM_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "nome", label: "Nome" },
  { value: "email", label: "Email" },
  { value: "celular", label: "Celular" },
  { value: "mensagem", label: "Observações / mensagem" },
  { value: "empresa", label: "Empresa" },
];

const CRM_ICONS: Record<string, LucideIcon> = {
  nome: User,
  email: Mail,
  celular: Phone,
  empresa: Building2,
  mensagem: MessageCircle,
};

/**
 * Catálogo demo alargado para formulários Meta / Lead Ads — em produção viria do schema real do formulário.
 * Cobre contacto, morada, empresa e perguntas típicas para poder mapear tudo o que o payload traz.
 */
const META_LEAD_FORM_FIELD_CATALOG: { key: string; label: string }[] = [
  { key: "full_name", label: "Nome completo" },
  { key: "first_name", label: "Nome próprio" },
  { key: "last_name", label: "Apelido" },
  { key: "email", label: "Endereço de email" },
  { key: "phone_number", label: "Telemóvel / telefone" },
  { key: "work_email", label: "Email profissional" },
  { key: "work_phone_number", label: "Telefone profissional" },
  { key: "street_address", label: "Morada" },
  { key: "city", label: "Cidade" },
  { key: "state", label: "Distrito ou estado" },
  { key: "zip_code", label: "Código postal" },
  { key: "country", label: "País" },
  { key: "company_name", label: "Nome da empresa" },
  { key: "job_title", label: "Cargo" },
  { key: "industry", label: "Sector de actividade" },
  { key: "annual_revenue_band", label: "Intervalo de facturação" },
  { key: "preferred_channel", label: "Canal de contacto preferido" },
  { key: "lead_topic", label: "Assunto do pedido" },
  { key: "extra_notes", label: "Comentários adicionais" },
  { key: "privacy_ack", label: "Consentimento RGPD" },
];

/** Campos típicos de conversas WhatsApp (demo). */
const WHATSAPP_LEAD_FIELD_CATALOG: { key: string; label: string }[] = [
  { key: "wa_profile_name", label: "Nome no perfil" },
  { key: "wa_from", label: "Número de origem" },
  { key: "wa_message_body", label: "Corpo da mensagem" },
  { key: "wa_timestamp", label: "Carimbo de data/hora" },
  { key: "wa_button_reply", label: "Resposta de botão ou lista" },
  { key: "wa_referral_source", label: "Origem da conversa" },
  { key: "wa_media_caption", label: "Legenda de média" },
  { key: "wa_location_label", label: "Etiqueta de localização" },
];

const GENERIC_LEAD_FIELD_CATALOG: { key: string; label: string }[] = [
  { key: "external_lead_id", label: "Identificador externo" },
  { key: "channel_label", label: "Canal de entrada" },
  { key: "raw_title", label: "Título ou assunto" },
  { key: "raw_body", label: "Corpo ou descrição" },
  { key: "contact_hint", label: "Dica de contacto" },
];

function catalogForSource(source: LeadRuleSource | null): { key: string; label: string }[] {
  if (source === "meta_form") return META_LEAD_FORM_FIELD_CATALOG;
  if (source === "whatsapp_api" || source === "whatsapp_qr" || source === ORGANIC_WHATSAPP_SOURCE) return WHATSAPP_LEAD_FIELD_CATALOG;
  return GENERIC_LEAD_FIELD_CATALOG;
}

const MAPPING_CRM_OPTIONS: { value: string; label: string }[] = [
  { value: "nome", label: "Nome" },
  { value: "celular", label: "Celular" },
  { value: "email", label: "Email" },
  { value: "empresa", label: "Empresa" },
  { value: "mensagem", label: "Observações / mensagem" },
  { value: "__ignore__", label: "Ignorar campo (não mapear)" },
];

function buildMappingsFromMetaFormGroups(
  groups: MetaFormFieldGroup[],
  existing: LeadFieldMapping[],
  options: { forceAuto: boolean },
): LeadFieldMapping[] {
  return buildLeadRuleMappingsFromMetaFormGroups(groups, existing, {
    forceAuto: options.forceAuto,
    makeId: mappingId,
  });
}

function buildMappingsFromMetaFields(
  fields: MetaFormField[],
  existing: LeadFieldMapping[],
  options: { forceAuto: boolean; formId?: string; formLabel?: string },
): LeadFieldMapping[] {
  const formId = options.formId?.trim();
  if (formId) {
    return buildMappingsFromMetaFormGroups(
      [{ formId, formLabel: options.formLabel?.trim() || formId, fields }],
      existing,
      options,
    );
  }
  return buildLeadRuleMappingsFromFields(fields, existing, {
    forceAuto: options.forceAuto,
    includeContext: true,
    makeId: mappingId,
  });
}

function MetaFieldTypeBadge({ type }: { type: string }) {
  const t = (type ?? "").toUpperCase();
  if (t === "CUSTOM") {
    return (
      <Badge className="border-line/80 bg-surface-elevated/60 text-[10px] font-medium text-content-muted">Personalizado</Badge>
    );
  }
  if (t === "FULL_NAME") {
    return (
      <Badge className="border-info/35 bg-info/10 text-[10px] font-medium text-info">
        Nome completo
      </Badge>
    );
  }
  if (t === "PHONE") {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/15 text-[10px] font-medium text-emerald-800 dark:text-emerald-200">
        Telefone
      </Badge>
    );
  }
  if (t === "EMAIL") {
    return (
      <Badge className="border-brand-secondary/30 bg-brand-secondary/10 text-[10px] font-medium text-brand-secondary dark:text-content-secondary">
        Email
      </Badge>
    );
  }
  return null;
}

function MetaMappingRow({
  m,
  metaType,
  onPickCrm,
}: {
  m: LeadFieldMapping;
  metaType?: string;
  onPickCrm: (crm: string) => void;
}) {
  const Icon = CRM_ICONS[m.crmField === "__ignore__" ? "mensagem" : m.crmField] ?? MessageCircle;
  const showKeySuffix = !m.sourceLabel.toLowerCase().includes(`(${m.sourceKey.toLowerCase()})`);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface-deep/20 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-content">
            {m.sourceLabel}
            {showKeySuffix ? <span className="font-normal text-content-muted"> ({m.sourceKey})</span> : null}
          </p>
          {metaType && m.kind === "form" ? <MetaFieldTypeBadge type={metaType} /> : null}
        </div>
        {m.kind === "context" ? (
          <p className="mt-0.5 text-[10px] text-content-faint">Campo de contexto · {m.sourceKey}</p>
        ) : null}
        {m.kind === "form" && metaType?.toUpperCase() === "CUSTOM" && m.crmField === "mensagem" ? (
          <p className="mt-1 text-[10px] font-medium text-content-muted">
            Pergunta personalizada salva como observação/contexto do lead.
          </p>
        ) : null}
      </div>
      <ArrowRight className="hidden h-4 w-4 shrink-0 text-content-faint sm:block" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1 sm:w-[min(100%,14rem)] sm:flex-none">
        <span className={typography.ui.overline}>Campo do CRM</span>
        <div className="flex items-center gap-2">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line/70 bg-surface-card text-content-muted"
            aria-hidden
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <Select
            aria-label={`CRM para ${m.sourceKey}`}
            className="min-h-[44px] flex-1"
            value={m.crmField}
            onChange={(e) => onPickCrm(e.target.value)}
          >
            {MAPPING_CRM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </li>
  );
}

const DISTRIBUTION_CHOICES: {
  value: LeadDistributionType;
  label: string;
  hint: string;
  group: "equipa" | "ia" | "crm";
}[] = [
  {
    value: "entry_owner",
    group: "crm",
    label: "Salvar no CRM apenas",
    hint: "O lead entra no CRM sem acionar agente de IA nem WhatsApp automático.",
  },
  {
    value: "specific_employees",
    group: "equipa",
    label: "Enviar para equipe humana",
    hint: "Escolha colaboradores cadastrados para receber este lead.",
  },
  {
    value: "automation_agent",
    group: "ia",
    label: "Atender com agente de IA",
    hint: "Escolha um agente ativo para iniciar o atendimento automaticamente.",
  },
];

const LEGACY_DISTRIBUTION_CHOICES: {
  value: LeadDistributionType;
  label: string;
  hint: string;
  group: "equipa" | "ia";
}[] = [
  {
    value: "round_robin_employees",
    group: "equipa",
    label: "Rodízio na equipa (legado)",
    hint: "Regra antiga preservada sem conversão automática.",
  },
  {
    value: "all_employees",
    group: "equipa",
    label: "Todos os colaboradores (legado)",
    hint: "Regra antiga preservada sem conversão automática.",
  },
  {
    value: "specific_agents",
    group: "ia",
    label: "Agentes de IA selecionados (legado)",
    hint: "Regra antiga preservada sem conversão automática.",
  },
  {
    value: "round_robin",
    group: "ia",
    label: "Rodízio entre agentes de IA (legado)",
    hint: "Regra antiga preservada sem conversão automática.",
  },
  {
    value: "all_agents",
    group: "ia",
    label: "Todos os agentes de IA (legado)",
    hint: "Regra antiga preservada sem conversão automática.",
  },
];

const ALL_DISTRIBUTION_CHOICES = [...DISTRIBUTION_CHOICES, ...LEGACY_DISTRIBUTION_CHOICES];

function newId() {
  return `lr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mappingId() {
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

type Draft = {
  name: string;
  redistribution: boolean;
  /** `null` = utilizador ainda não escolheu (só em criação). */
  source: LeadRuleSource | null;
  transport: "evolution" | "cloud_api";
  connectionId: string;
  metaTemplateName: string;
  metaTemplateLang: string;
  conflictPolicy: NonNullable<LeadDistributionRule["conflictPolicy"]>;
  conflictInactivityMinutes: number;
  pageLabel: string;
  pageId: string;
  useAllForms: boolean;
  /** Quando `useAllForms`, formulários a não distribuir (ids da lista demo). */
  excludedFormIds: string[];
  /** Quando `!useAllForms`, só estes formulários aplicam à regra (ids demo). */
  includedFormIds: string[];
  mappings: LeadFieldMapping[];
  /** `null` = ainda não escolheu no passo «Distribuição» (criação). */
  distributionType: LeadDistributionType | null;
  agentIds: string[];
  employeeIds: string[];
  conversionSendEnabled: boolean;
  conversionPixelId: string;
  conversionApiSecret: string;
  redistributionConfig: NonNullable<LeadDistributionRule["redistributionConfig"]>;
};

function sourceLabelOrPlaceholder(s: LeadRuleSource | null): string {
  if (!s) return "Ainda não escolhida";
  return sourceLabel(s);
}

const emptyDraft = (): Draft => ({
  name: "",
  redistribution: false,
  source: null,
  transport: "evolution",
  connectionId: "",
  metaTemplateName: "",
  metaTemplateLang: "pt_BR",
  conflictPolicy: "latest_wins",
  conflictInactivityMinutes: 1440,
  pageLabel: "",
  pageId: "",
  useAllForms: false,
  excludedFormIds: [],
  includedFormIds: [],
  mappings: [],
  distributionType: null,
  agentIds: [],
  employeeIds: [],
  conversionSendEnabled: true,
  conversionPixelId: "",
  conversionApiSecret: "",
  redistributionConfig: {
    prazo_minutos: 5,
    quantidade: 2,
    tipo: "round_robin",
    agent_ids: [],
    employee_ids: [],
    executar_anteriores: true,
    triggers: {
      agent_unavailable: true,
      delivery_failed: true,
      human_timeout: false,
      customer_silence: false,
    },
    final_destination: "next_agent",
  },
});

function ruleToDraft(r: LeadDistributionRule): Draft {
  return {
    name: r.name,
    redistribution: r.redistribution,
    source: r.source,
    transport: r.transport ?? (r.source === "whatsapp_api" ? "cloud_api" : "evolution"),
    connectionId: r.connectionId ?? "",
    metaTemplateName: r.metaTemplateName ?? "",
    metaTemplateLang: r.metaTemplateLang ?? "pt_BR",
    conflictPolicy: r.conflictPolicy ?? "latest_wins",
    conflictInactivityMinutes: r.conflictInactivityMinutes ?? 1440,
    pageLabel: r.pageLabel ?? "",
    pageId: r.pageId ?? "",
    useAllForms: r.useAllForms ?? true,
    excludedFormIds: [...(r.excludedFormIds ?? [])],
    includedFormIds: [...(r.includedFormIds ?? [])],
    mappings: r.mappings.map((m) => ({ ...m })),
    distributionType: r.distributionType,
    agentIds: [...r.agentIds],
    employeeIds: [...(r.employeeIds ?? [])],
    conversionSendEnabled: r.conversionSendEnabled ?? false,
    conversionPixelId: r.conversionPixelId ?? "",
    conversionApiSecret: r.conversionApiSecret ?? "",
    redistributionConfig: r.redistributionConfig ?? {
      prazo_minutos: 5,
      quantidade: 2,
      tipo: "round_robin",
      agent_ids: [],
      employee_ids: [],
      executar_anteriores: true,
      triggers: {
        agent_unavailable: true,
        delivery_failed: true,
        human_timeout: false,
        customer_silence: false,
      },
      final_destination: "next_agent",
    },
  };
}

export function NewLeadRuleWizard({
  open,
  onClose,
  agents,
  displayName,
  tenantId,
  onCreated,
  onUpdated,
  initialRule,
}: {
  open: boolean;
  onClose: () => void;
  agents: Agent[];
  displayName: string;
  tenantId: string;
  onCreated: (rule: LeadDistributionRule) => void;
  /** Ao editar uma regra existente; se omitido, só criação. */
  onUpdated?: (rule: LeadDistributionRule) => void;
  /** Regra em edição (mesmo fluxo do assistente). */
  initialRule?: LeadDistributionRule | null;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [excludeFormPicker, setExcludeFormPicker] = useState("");
  const [includeFormPicker, setIncludeFormPicker] = useState("");
  const [distPickerOpen, setDistPickerOpen] = useState(false);
  const [distQuery, setDistQuery] = useState("");
  const [metaPages, setMetaPages] = useState<MetaStatusPage[]>([]);
  const [metaPagesLoading, setMetaPagesLoading] = useState(false);
  const [metaPagesError, setMetaPagesError] = useState<string | null>(null);
  const [whatsAppConnections, setWhatsAppConnections] = useState<
    Array<{
      id: string;
      slot_index: number;
      instance_name: string;
      connection_state: string;
      wa_jid: string | null;
    }>
  >([]);
  const [cloudApiConnections, setCloudApiConnections] = useState<
    Array<{ connectionId: string; label: string; slotIndex: number; connected: boolean }>
  >([]);
  const [metaTemplates, setMetaTemplates] = useState<
    Array<{ name: string; status: string; language: string | null; bodyText: string | null }>
  >([]);
  const [metaTemplatesLoading, setMetaTemplatesLoading] = useState(false);
  const [availableForms, setAvailableForms] = useState<MetaFormsForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [metaFormFieldGroups, setMetaFormFieldGroups] = useState<MetaFormFieldGroup[]>([]);
  const [fieldsFetchLoading, setFieldsFetchLoading] = useState(false);
  const [fieldsFetchError, setFieldsFetchError] = useState<string | null>(null);
  const [employeesRev, setEmployeesRev] = useState(0);
  const { isLight } = usePanelAppearance();
  const distButtonRef = useRef<HTMLButtonElement>(null);
  const distPopoverRef = useRef<HTMLDivElement>(null);
  const [distPopoverRect, setDistPopoverRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  /** Para aplicar mapeamento automático só na transição 0 → 1 (evita sobrescrever ao voltar do passo 2). */
  const prevStepRef = useRef(0);
  const formId = useId();

  const isEditMode = Boolean(initialRule);

  const teamEmployees = useMemo(() => {
    void employeesRev;
    return loadTeamEmployees(tenantId);
  }, [tenantId, employeesRev]);

  useEffect(() => {
    const onEmp = () => setEmployeesRev((n) => n + 1);
    window.addEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, onEmp);
    return () => window.removeEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, onEmp);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshTeamEmployeesFromApi(tenantId).then(() => setEmployeesRev((n) => n + 1));
  }, [open, tenantId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setMetaPagesLoading(true);
    setMetaPagesError(null);
    void (async () => {
      try {
        const response = await fetch("/api/client/meta/status", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("meta_status_unavailable");
        const data = (await response.json()) as { pages?: MetaStatusPage[] };
        setMetaPages(
          (data.pages ?? []).filter(
            (page) =>
              (page.health_status === "ready" ||
                page.health_status === "degraded" ||
                page.health_status === "legacy_grace") &&
              !page.forms_error,
          ),
        );
      } catch {
        if (controller.signal.aborted) return;
        setMetaPages([]);
        setMetaPagesError(
          "Não foi possível consultar suas Páginas Meta agora. Nenhuma regra foi alterada.",
        );
      } finally {
        if (!controller.signal.aborted) setMetaPagesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/client/lead-rules/connections", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            connections?: Array<{
              id: string;
              slot_index: number;
              instance_name: string;
              connection_state: string;
              wa_jid: string | null;
            }>;
          } | null,
        ) => setWhatsAppConnections(payload?.connections ?? []),
      )
      .catch(() => setWhatsAppConnections([]));
    fetch("/api/client/whatsapp/connections", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            connections?: Array<{
              connectionId: string;
              transport: string;
              label: string;
              slotIndex: number;
              connected: boolean;
            }>;
          } | null,
        ) =>
          setCloudApiConnections(
            (payload?.connections ?? [])
              .filter((c) => c.transport === "cloud_api")
              .map((c) => ({
                connectionId: c.connectionId,
                label: c.label,
                slotIndex: c.slotIndex,
                connected: c.connected,
              })),
          ),
      )
      .catch(() => setCloudApiConnections([]));
  }, [open]);

  useEffect(() => {
    if (!open || draft.transport !== "cloud_api" || !draft.connectionId.trim()) {
      setMetaTemplates([]);
      return;
    }
    let cancelled = false;
    setMetaTemplatesLoading(true);
    fetch(
      `/api/client/whatsapp-campaigns/meta-templates?connectionId=${encodeURIComponent(draft.connectionId.trim())}`,
      { credentials: "same-origin" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            templates?: Array<{
              name: string;
              status: string;
              language: string | null;
              bodyText: string | null;
            }>;
          } | null,
        ) => {
          if (cancelled) return;
          const approved = (data?.templates ?? []).filter((t) => t.status === "APPROVED");
          setMetaTemplates(approved);
        },
      )
      .catch(() => {
        if (!cancelled) setMetaTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setMetaTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft.transport, draft.connectionId]);

  const syncDistPopoverRect = useCallback(() => {
    const btn = distButtonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const gap = 6;
    const edge = 12;
    const top = Math.round(r.bottom + gap);
    const available = window.innerHeight - top - edge;
    const maxHeight = Math.max(160, Math.min(Math.round(22 * 16), Math.round(available)));
    setDistPopoverRect({
      top,
      left: Math.round(r.left),
      width: Math.round(r.width),
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!distPickerOpen) {
      setDistPopoverRect(null);
      return;
    }
    syncDistPopoverRect();
    let raf = 0;
    raf = requestAnimationFrame(() => syncDistPopoverRect());
    window.addEventListener("resize", syncDistPopoverRect);
    const scrollOpts: AddEventListenerOptions = { capture: true };
    document.addEventListener("scroll", syncDistPopoverRect, scrollOpts);
    const btn = distButtonRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" && btn ? new ResizeObserver(() => syncDistPopoverRect()) : null;
    if (btn && ro) ro.observe(btn);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", syncDistPopoverRect);
      document.removeEventListener("scroll", syncDistPopoverRect, scrollOpts);
      ro?.disconnect();
    };
  }, [distPickerOpen, syncDistPopoverRect]);

  useEffect(() => {
    if (!distPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (distButtonRef.current?.contains(t) || distPopoverRef.current?.contains(t)) return;
      setDistPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [distPickerOpen]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    prevStepRef.current = 0;
    setMetaFormFieldGroups([]);
    setFieldsFetchLoading(false);
    setFieldsFetchError(null);
    setExcludeFormPicker("");
    setIncludeFormPicker("");
    setDistPickerOpen(false);
    if (initialRule) {
      setDraft(ruleToDraft(initialRule));
    } else {
      setDraft(emptyDraft());
    }
    /* Reidratar só ao abrir ou quando muda o id — evita reset se o pai repassar novo objeto da mesma regra. */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dependência intencional em `initialRule?.id`
  }, [open, initialRule?.id]);

  /** WhatsApp sem tráfego pago: uma regra, um agente — evita dois agentes a disputar o mesmo contacto. */
  useEffect(() => {
    if (draft.source !== ORGANIC_WHATSAPP_SOURCE) return;
    setDraft((d) => {
      const nextIds = d.agentIds.slice(0, 1);
      if (!d.redistribution && d.distributionType === "specific_agents" && d.agentIds.length === nextIds.length && nextIds.every((id, i) => id === d.agentIds[i])) {
        return d;
      }
      return {
        ...d,
        redistribution: false,
        distributionType: "specific_agents",
        agentIds: nextIds,
        employeeIds: [],
      };
    });
  }, [draft.source]);

  const isOrganicWhatsApp = draft.source === ORGANIC_WHATSAPP_SOURCE;

  const facebookPageSelectOptions = useMemo(() => {
    const opts = metaPages.map((page) => ({
      value: page.page_id,
      label: page.page_name ?? page.page_id,
    }));
    if (draft.pageId.trim() && !opts.some((o) => o.value === draft.pageId)) {
      opts.push({ value: draft.pageId, label: draft.pageLabel || draft.pageId });
    }
    return opts;
  }, [draft.pageId, draft.pageLabel, metaPages]);

  // Fetch forms in real-time from the Meta Graph API whenever the selected page changes.
  useEffect(() => {
    if (!open || draft.source !== "meta_form" || !draft.pageId.trim()) {
      setAvailableForms([]);
      setFormsLoading(false);
      setFormsError(null);
      return;
    }
    let cancelled = false;
    setFormsLoading(true);
    setFormsError(null);
    setAvailableForms([]);
    fetch(`/api/client/meta/forms?page_id=${encodeURIComponent(draft.pageId)}`, {
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then((d: { forms?: MetaFormsForm[]; error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setFormsError(d.error);
          setAvailableForms([]);
        } else {
          setAvailableForms(d.forms ?? []);
          setFormsError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFormsError(err instanceof Error ? err.message : "Erro ao buscar formulários");
        setAvailableForms([]);
      })
      .finally(() => {
        if (!cancelled) setFormsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft.source, draft.pageId]);

  const metaFormLabel = useCallback(
    (id: string) => availableForms.find((form) => form.form_id === id)?.form_name ?? id,
    [availableForms],
  );

  const applyCatalogMappings = useCallback(
    (forceAuto: boolean) => {
      const src = draft.source;
      if (!src) return;
      const formCatalog = catalogForSource(src);
      const existing = draft.mappings;
      const mappings = buildLeadRuleMappingsFromFields(formCatalog, existing, {
        forceAuto,
        includeContext: src === "meta_form",
        makeId: mappingId,
      });
      setDraft((d) => ({ ...d, mappings }));
    },
    [draft.mappings, draft.source],
  );

  /**
   * Ref estável para applyCatalogMappings — atualizado em cada render.
   * Permite o useEffect de fetch usá-lo sem incluí-lo no array de dependências,
   * evitando um loop infinito: fetch sucesso → draft.mappings muda →
   * applyCatalogMappings nova referência → effect re-executa → novo fetch → …
   */
  const applyCatalogMappingsFn = useRef(applyCatalogMappings);
  applyCatalogMappingsFn.current = applyCatalogMappings;

  const refazerMapeamentoAutomatico = useCallback(() => {
    if (draft.source === "meta_form" && metaFormFieldGroups.length > 0) {
      setDraft((d) => ({
        ...d,
        mappings: buildMappingsFromMetaFormGroups(metaFormFieldGroups, [], { forceAuto: true }),
      }));
      return;
    }
    applyCatalogMappings(true);
  }, [applyCatalogMappings, draft.source, metaFormFieldGroups]);

  const metaFieldTypeByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of metaFormFieldGroups) {
      for (const f of group.fields) {
        map.set(mappingLookupKey(f.key, group.formId), f.type ?? "CUSTOM");
      }
    }
    return map;
  }, [metaFormFieldGroups]);

  /** Ao entrar no passo Mapeamento: busca campos reais (Meta) ou catálogo de fallback. */
  useEffect(() => {
    if (!open || step !== 1 || !draft.source) return;

    if (draft.source !== "meta_form") {
      setMetaFormFieldGroups([]);
      setFieldsFetchError(null);
      setFieldsFetchLoading(false);
      if (draft.mappings.length === 0) applyCatalogMappingsFn.current(true);
      return;
    }

    if (draft.useAllForms) {
      setMetaFormFieldGroups([]);
      setFieldsFetchLoading(false);
      setFieldsFetchError("Selecione formulários específicos no passo Entrada para mapear os campos.");
      return;
    }

    const formIds = draft.includedFormIds.map((id) => id.trim()).filter(Boolean);
    if (formIds.length === 0 || !draft.pageId.trim()) {
      setMetaFormFieldGroups([]);
      setFieldsFetchLoading(false);
      setFieldsFetchError("Selecione um ou mais formulários no passo anterior.");
      return;
    }

    let cancelled = false;
    setFieldsFetchLoading(true);
    setFieldsFetchError(null);

    void Promise.all(
      formIds.map(async (formId) => {
        const res = await fetch(
          `/api/client/meta/form-fields?form_id=${encodeURIComponent(formId)}&page_id=${encodeURIComponent(draft.pageId)}`,
          { credentials: "same-origin" },
        );
        const data = (await res.json()) as { fields?: MetaFormField[]; error?: string };
        const label = metaFormLabel(formId);
        if (data.error) throw new Error(`${label}: ${data.error}`);
        const fields = data.fields ?? [];
        if (fields.length === 0) throw new Error(`${label}: nenhum campo encontrado neste formulário.`);
        return { formId, formLabel: label, fields };
      }),
    )
      .then((groups) => {
        if (cancelled) return;
        setMetaFormFieldGroups(groups);
        setDraft((d) => ({
          ...d,
          mappings: buildMappingsFromMetaFormGroups(groups, d.mappings, {
            forceAuto: d.mappings.filter((m) => m.kind === "form").length === 0,
          }),
        }));
        setFieldsFetchError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Erro ao buscar campos do formulário";
        setFieldsFetchError(msg);
        setMetaFormFieldGroups([]);
      })
      .finally(() => {
        if (!cancelled) setFieldsFetchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  // applyCatalogMappings é intencionalmente omitido: é lido via ref estável (applyCatalogMappingsFn)
  // para evitar loop fetch → draft.mappings muda → nova ref → effect re-executa.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.includedFormIds, draft.pageId, draft.source, draft.useAllForms, open, step]);

  const formMappings = useMemo(() => draft.mappings.filter((m) => m.kind === "form"), [draft.mappings]);
  const contextMappings = useMemo(() => draft.mappings.filter((m) => m.kind === "context"), [draft.mappings]);

  const mappingStepHealthByForm = useMemo(
    () => computeFormMappingHealth(draft.mappings, metaFormFieldGroups),
    [draft.mappings, metaFormFieldGroups],
  );

  const mappingStepHealth = useMemo(() => {
    const active = draft.mappings.filter((m) => m.crmField !== "__ignore__");
    const hasNome = active.some((m) => m.crmField === "nome");
    const hasCelular = active.some((m) => m.crmField === "celular");
    const hasEmail = active.some((m) => m.crmField === "email");
    const canAdvance = hasCelular || hasEmail;
    const warnEssential = !hasNome || !hasCelular;
    return { hasNome, hasCelular, hasEmail, canAdvance, warnEssential };
  }, [draft.mappings]);

  const filteredDistChoices = useMemo(() => {
    const q = distQuery.trim().toLowerCase();
    return DISTRIBUTION_CHOICES.filter((c) => !q || `${c.label} ${c.hint}`.toLowerCase().includes(q));
  }, [distQuery]);

  const currentDistChoice = useMemo(() => {
    if (!draft.distributionType) return null;
    return ALL_DISTRIBUTION_CHOICES.find((c) => c.value === draft.distributionType) ?? null;
  }, [draft.distributionType]);

  const canAdvance = useMemo(() => {
    if (step === 0) {
      const base = draft.name.trim().length >= 2 && draft.source !== null;
      if (draft.source === "meta_form") {
        if (!draft.pageId.trim()) return false;
        if (!draft.useAllForms && draft.includedFormIds.length === 0) return false;
      }
      if (draft.source === ORGANIC_WHATSAPP_SOURCE && !draft.connectionId.trim()) {
        return false;
      }
      return base;
    }
    if (step === 1) {
      if (draft.source === "meta_form" && !draft.useAllForms && mappingStepHealthByForm.length > 0) {
        return mappingStepHealthByForm.every((h) => h.canAdvance);
      }
      const active = draft.mappings.filter((m) => m.crmField !== "__ignore__");
      return active.some((m) => m.crmField === "celular") || active.some((m) => m.crmField === "email");
    }
    if (step === 2) {
      if (isOrganicWhatsApp) {
        if (draft.agentIds.length !== 1) return false;
        if (!draft.connectionId.trim()) return false;
        if (draft.transport === "cloud_api" && !draft.metaTemplateName.trim()) return false;
        return true;
      }
      if (!draft.distributionType) return false;
      if (
        draft.source === "meta_form" &&
        ["automation_agent", "specific_agents", "round_robin"].includes(draft.distributionType) &&
        !draft.connectionId.trim()
      ) {
        return false;
      }
      if (
        draft.source === "meta_form" &&
        draft.transport === "cloud_api" &&
        ["automation_agent", "specific_agents", "round_robin"].includes(draft.distributionType) &&
        !draft.metaTemplateName.trim()
      ) {
        return false;
      }
      const roster = teamEmployees.length;
      if (
        (draft.distributionType === "specific_employees" ||
          draft.distributionType === "round_robin_employees" ||
          draft.distributionType === "all_employees") &&
        roster === 0
      ) {
        return false;
      }
      if (draft.distributionType === "specific_employees" && draft.employeeIds.length === 0) return false;
      if (draft.distributionType === "round_robin_employees" && draft.employeeIds.length === 0) return false;
      if (draft.distributionType === "specific_agents" && draft.agentIds.length === 0) return false;
      if (draft.distributionType === "automation_agent" && draft.agentIds.length !== 1) return false;
      return true;
    }
    return true;
  }, [
    draft.agentIds.length,
    draft.connectionId,
    draft.distributionType,
    draft.employeeIds.length,
    draft.includedFormIds.length,
    draft.mappings,
    draft.metaTemplateName,
    draft.name,
    draft.pageId,
    draft.source,
    draft.transport,
    draft.useAllForms,
    isOrganicWhatsApp,
    mappingStepHealthByForm,
    step,
    teamEmployees.length,
  ]);

  const submit = () => {
    if (!draft.source) {
      setStep(0);
      return;
    }
    if (isOrganicWhatsApp && draft.agentIds.length !== 1) {
      setStep(2);
      return;
    }
    if (!draft.distributionType) {
      setStep(2);
      return;
    }
    const dist = draft.distributionType;
    if (dist === "specific_agents" && draft.agentIds.length === 0) {
      setStep(2);
      return;
    }
    if (dist === "automation_agent" && draft.agentIds.length !== 1) {
      setStep(2);
      return;
    }
    if ((dist === "specific_employees" || dist === "round_robin_employees") && draft.employeeIds.length === 0) {
      setStep(2);
      return;
    }
    if (
      (dist === "specific_employees" || dist === "round_robin_employees" || dist === "all_employees") &&
      teamEmployees.length === 0
    ) {
      setStep(2);
      return;
    }
    if (draft.source === "meta_form" && !draft.pageId.trim()) {
      setStep(0);
      return;
    }
    if (draft.source === "meta_form" && !draft.useAllForms && draft.includedFormIds.length === 0) {
      setStep(0);
      return;
    }
    if (
      draft.source === "meta_form" &&
      ["automation_agent", "specific_agents", "round_robin"].includes(dist) &&
      !draft.connectionId.trim()
    ) {
      setStep(0);
      return;
    }
    if (
      draft.source === "meta_form" &&
      draft.transport === "cloud_api" &&
      ["automation_agent", "specific_agents", "round_robin"].includes(dist) &&
      !draft.metaTemplateName.trim()
    ) {
      setStep(0);
      return;
    }
    if (initialRule && onUpdated) {
      const rule: LeadDistributionRule = {
        ...initialRule,
        name: draft.name.trim(),
        source: draft.source,
        transport: draft.transport,
        connectionId: draft.connectionId || null,
        metaTemplateName: draft.transport === "cloud_api" ? draft.metaTemplateName || null : null,
        metaTemplateLang: draft.transport === "cloud_api" ? draft.metaTemplateLang || "pt_BR" : null,
        conflictPolicy: draft.conflictPolicy,
        conflictInactivityMinutes: draft.conflictInactivityMinutes,
        redistribution: draft.redistribution,
        distributionType: dist,
        agentIds:
          isOrganicWhatsApp
            ? draft.agentIds.slice(0, 1)
            : dist === "specific_agents"
            ? [...draft.agentIds]
            : dist === "automation_agent"
              ? draft.agentIds.slice(0, 1)
              : [],
        mappings: draft.mappings,
        pageLabel: draft.pageLabel,
        pageId: draft.pageId,
        useAllForms: draft.useAllForms,
        excludedFormIds: draft.useAllForms ? [...draft.excludedFormIds] : [],
        includedFormIds: !draft.useAllForms ? [...draft.includedFormIds] : [],
        conversionSendEnabled: draft.conversionSendEnabled,
        conversionPixelId: draft.conversionSendEnabled ? draft.conversionPixelId.trim() : "",
        conversionApiSecret: draft.conversionSendEnabled ? draft.conversionApiSecret : "",
        redistributionConfig: draft.redistribution ? draft.redistributionConfig : undefined,
        employeeIds: dist === "specific_employees" || dist === "round_robin_employees" ? [...draft.employeeIds] : [],
      };
      onUpdated(rule);
      onClose();
      return;
    }
    const rule: LeadDistributionRule = {
      id: newId(),
      name: draft.name.trim(),
      order: 999,
      source: draft.source,
      transport: draft.transport,
      connectionId: draft.connectionId || null,
      metaTemplateName: draft.transport === "cloud_api" ? draft.metaTemplateName || null : null,
      metaTemplateLang: draft.transport === "cloud_api" ? draft.metaTemplateLang || "pt_BR" : null,
      conflictPolicy: draft.conflictPolicy,
      conflictInactivityMinutes: draft.conflictInactivityMinutes,
      redistribution: draft.redistribution,
      distributionType: dist,
      agentIds:
        isOrganicWhatsApp
          ? draft.agentIds.slice(0, 1)
          : dist === "specific_agents"
            ? [...draft.agentIds]
            : dist === "automation_agent"
              ? draft.agentIds.slice(0, 1)
              : [],
      mappings: draft.mappings,
      pageLabel: draft.pageLabel,
      pageId: draft.pageId,
      useAllForms: draft.useAllForms,
      excludedFormIds: draft.useAllForms ? [...draft.excludedFormIds] : [],
      includedFormIds: !draft.useAllForms ? [...draft.includedFormIds] : [],
      conversionSendEnabled: draft.conversionSendEnabled,
      conversionPixelId: draft.conversionSendEnabled ? draft.conversionPixelId.trim() : "",
      conversionApiSecret: draft.conversionSendEnabled ? draft.conversionApiSecret : "",
      redistributionConfig: draft.redistribution ? draft.redistributionConfig : undefined,
      employeeIds: dist === "specific_employees" || dist === "round_robin_employees" ? [...draft.employeeIds] : [],
      createdBy: displayName,
      createdAtLabel: new Date().toLocaleDateString("pt-BR"),
    };
    onCreated(rule);
    onClose();
  };

  const titleContent = (
    <div className="min-w-0 pr-2">
      <p className="text-lg font-semibold leading-snug text-content">
        {isEditMode ? "Editar regra de distribuição de leads" : "Nova regra de distribuição de leads"}
      </p>
      <nav className="mt-3 flex flex-wrap items-center gap-0.5 border-b border-line/60 pb-0.5 sm:gap-1" aria-label="Passos do assistente">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          const labelUp = label.toUpperCase();
          return (
            <div key={label} className="flex min-w-0 flex-1 items-center sm:flex-initial sm:flex-none">
              {i > 0 ? (
                <ChevronRight className="mx-0.5 hidden h-3.5 w-3.5 shrink-0 text-content-faint sm:block" aria-hidden />
              ) : null}
              <div
                className={cn(
                  "flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition sm:min-w-[5.5rem] sm:text-[11px]",
                  active ? "border-primary text-primary" : "border-transparent text-content-muted",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden /> : null}
                {!done && !active ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-content-muted">
                    {i + 1}
                  </span>
                ) : null}
                {active ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                    {i + 1}
                  </span>
                ) : null}
                <span className="max-w-[4.25rem] truncate text-center leading-tight sm:max-w-[6.5rem] md:max-w-none">
                  {labelUp}
                </span>
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );

  const footer = (
    <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            ← Voltar
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-xs tabular-nums text-content-muted">
          {String(step + 1).padStart(2, "0")} de {STEPS.length}
        </span>
        {step < STEPS.length - 1 ? (
          <Button type="button" variant="gradient" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
            Avançar <ChevronRight className="ml-1 inline h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button type="button" variant="primary" className="bg-emerald-600 hover:bg-emerald-500" onClick={submit}>
            <Check className="mr-1.5 inline h-4 w-4" aria-hidden />
            {isEditMode ? "Guardar alterações" : "Criar regra"}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditMode ? "Editar regra de distribuição de leads" : "Nova regra de distribuição de leads"}
      titleContent={titleContent}
      footer={footer}
      className="max-w-4xl"
    >
      <div className="space-y-5 text-sm text-content-secondary">
        {step === 0 ? (
          <div className="space-y-6">
            <p className="text-sm leading-relaxed text-content-secondary">
              Comece por dar um nome à regra e dizer <strong className="font-medium text-content">de onde vêm os contactos</strong>. Depois, nos passos seguintes,
              você liga campos ao CRM e escolhe o agente — sem precisar ser técnico nesta primeira etapa.
            </p>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-content-muted" htmlFor={`${formId}-name`}>
                Nome da regra <span className="text-primary">*</span>
              </label>
              <Input
                id={`${formId}-name`}
                className="mt-2 h-11 rounded-xl border-line text-base sm:text-sm"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Defina um nome para a regra, ex.: Campanhas · fila comercial"
                autoComplete="off"
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-content">
                Escolha a origem dos contactos <span className="text-primary">*</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-content-muted">
                Toque num cartão para selecionar — nada vem pré-selecionado. Cada opção corresponde a um canal que você pode ligar em{" "}
                <Link href="/dashboard/integracoes" className="font-medium text-primary underline-offset-2 hover:underline">
                  Integrações
                </Link>
                .
              </p>
              {!draft.source ? (
                <p className={cn("mt-2 text-xs font-medium", isLight ? "text-amber-800" : "text-amber-300/90")}>
                  Selecione uma origem para poder avançar para o mapeamento.
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">
                {(
                  [
                    {
                      id: "meta_form" as const,
                      title: "Facebook",
                      sub: "Campanhas e formulários",
                      iconBg: isLight ? "bg-blue-500/15 text-blue-600" : "bg-blue-500/15 text-blue-300",
                    },
                    {
                      id: ORGANIC_WHATSAPP_SOURCE,
                      title: "WhatsApp direto",
                      sub: "Mensagens espontâneas no privado",
                      iconBg: isLight ? "bg-emerald-500/12 text-emerald-700" : "bg-emerald-500/12 text-emerald-200",
                    },
                  ] as const
                ).map((card) => {
                  const selected = draft.source === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => {
                        setDraft((d) => ({
                          ...d,
                          source: card.id,
                          ...(card.id === "meta_form"
                            ? {}
                            : { pageId: "", pageLabel: "", excludedFormIds: [], includedFormIds: [] }),
                        }));
                      }}
                      className={cn(
                        "relative flex min-h-[132px] w-[calc(50%-0.375rem)] min-w-[140px] max-w-[200px] flex-1 flex-col items-center rounded-xl border px-3 pb-4 pt-5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-[min(100%,11.5rem)] sm:max-w-none sm:flex-none",
                        "hover:border-primary/40 hover:bg-surface-deep/40",
                        selected ? "border-primary bg-primary/[0.07] ring-2 ring-primary/35" : "border-line bg-surface-card/80",
                      )}
                    >
                      {selected ? (
                        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
                          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                        </span>
                      ) : null}
                      <span className={cn("mb-3 flex h-12 w-12 items-center justify-center rounded-xl", card.iconBg)}>
                        {card.id === ORGANIC_WHATSAPP_SOURCE ? (
                          <WhatsAppGlyph className="h-7 w-7 shrink-0" aria-hidden />
                        ) : card.id === "meta_form" ? (
                          <FacebookMark className="h-7 w-7" />
                        ) : (
                          <WhatsAppQrMark className="h-7 w-7 shrink-0" />
                        )}
                      </span>
                      <span className="text-sm font-semibold leading-tight text-content">{card.title}</span>
                      <span className="mt-1.5 text-[11px] leading-snug text-content-muted">{card.sub}</span>
                    </button>
                  );
                })}
              </div>
              {draft.source === "other" ? (
                <p className={cn("mt-3 text-xs leading-relaxed", isLight ? "text-amber-800" : "text-amber-300/90")}>
                  Esta regra está ligada a <strong className="text-content">{sourceLabel(draft.source)}</strong>, uma origem que já não é escolhível aqui. Para mudar o canal,
                  toque num dos cartões acima; caso contrário, pode continuar a editar com a origem actual.
                </p>
              ) : null}
            </div>

            {draft.source === "meta_form" ? (
              <div className="space-y-4 rounded-xl border border-line/80 bg-surface-deep/15 p-4 sm:p-5">
                <div className="flex items-start gap-2">
                  <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-content">Página e formulários</p>
                    <p className="mt-0.5 text-xs text-content-muted">Ligue esta regra à página certa do Facebook. Em produção, a lista vem da Meta após autorizar a conta.</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-content" id={`${formId}-fb-page-label`}>
                    Selecione a página do Facebook para esta regra <span className="text-primary">*</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-content-muted">
                    Nada vem pré-selecionado — toque na página vinculada de onde quer puxar os formulários.
                  </p>
                  {metaPagesLoading ? (
                    <p className="mt-3 text-xs text-content-muted">
                      Consultando Páginas Meta…
                    </p>
                  ) : metaPagesError ? (
                    <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-content-secondary">
                      {metaPagesError}
                    </p>
                  ) : metaPages.length === 0 && !draft.pageId.trim() ? (
                    <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-content-secondary">
                      Nenhuma Página Meta operacional está disponível. Verifique a conexão em Integrações.
                    </p>
                  ) : null}
                  <div
                    className="mt-3 overflow-hidden rounded-xl border border-line/80 bg-surface-deep/60"
                    role="radiogroup"
                    aria-labelledby={`${formId}-fb-page-label`}
                  >
                    {facebookPageSelectOptions.map((o, i) => {
                      const selected = draft.pageId === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              pageId: o.value,
                              pageLabel: o.label,
                              excludedFormIds: [],
                              includedFormIds: [],
                            }))
                          }
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-3 text-left transition sm:gap-3.5 sm:px-4 sm:py-3.5",
                            i > 0 && "border-t border-line/70",
                            selected
                              ? "bg-primary/[0.08] ring-1 ring-inset ring-primary/30"
                              : "hover:bg-surface-card/70",
                          )}
                        >
                          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1", isLight ? "bg-white ring-black/[0.06]" : "bg-surface-elevated ring-line/60")}>
                            <FacebookMark className="h-7 w-7" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-content">{o.label}</span>
                            {o.value !== o.label ? (
                              <span className="mt-0.5 block truncate text-[11px] text-content-muted">{o.value}</span>
                            ) : null}
                          </span>
                          {selected ? <Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden /> : null}
                        </button>
                      );
                    })}
                  </div>
                  {!draft.pageId.trim() ? (
                    <p className="mt-2 text-xs font-medium text-amber-300/90">
                      Escolha uma página para poder avançar e vincular os formulários.
                    </p>
                  ) : null}
                  <Link
                    href="/dashboard/integracoes#canal-facebook"
                    className="mt-2 inline-block text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    + Conectar outra página
                  </Link>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-3 text-sm text-content-secondary">
                  <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <p>
                    <span className="font-medium text-content">Página selecionada:</span> {draft.pageLabel || "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-line/70 bg-surface-card/50 p-4">
                  <div className="flex items-start gap-2">
                    <MessageCircle
                      className={cn("mt-0.5 h-5 w-5 shrink-0", isLight ? "text-emerald-600" : "text-emerald-400")}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-content">Configuração de Formulários</p>
                      <div className="mt-3">
                        <Toggle
                          id={`${formId}-allforms`}
                          checked={draft.useAllForms}
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              useAllForms: v,
                              excludedFormIds: v ? d.excludedFormIds : [],
                              includedFormIds: v ? [] : d.includedFormIds,
                            }))
                          }
                          label="Usar todos os formulários desta página?"
                          description="Se desligar, no produto final você escolheria formulários específicos ligados à Meta."
                        />
                      </div>
                      {draft.useAllForms ? (
                        <div className={cn("mt-4 rounded-xl border p-4", isLight ? "border-rose-200 bg-rose-50/95" : "border-rose-900/55 bg-rose-950/35")}>
                          <div className="flex items-start gap-2">
                            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1", isLight ? "bg-rose-100 text-rose-600 ring-rose-200" : "bg-rose-900/60 text-rose-300 ring-rose-800")}>
                              <AlertCircle className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm font-semibold", isLight ? "text-rose-900" : "text-rose-100")}>
                                Formulários a Desconsiderar (Opcional)
                              </p>
                              <div className={cn("mt-3 rounded-lg border px-3 py-2.5", isLight ? "border-rose-200/90 bg-rose-100/70" : "border-rose-800/80 bg-rose-950/50")}>
                                <p className={cn("text-xs font-semibold leading-relaxed", isLight ? "text-rose-800" : "text-rose-200")}>
                                  <span className="uppercase tracking-wide">Atenção:</span> Formulários adicionados aqui{" "}
                                  <strong className="font-bold">NÃO</strong> serão distribuídos.
                                </p>
                              </div>
                              <label
                                id={`${formId}-exclude-form-label`}
                                className={cn("mt-3 block text-[11px] font-medium", isLight ? "text-rose-900/80" : "text-rose-200/90")}
                                htmlFor={`${formId}-exclude-form-search`}
                              >
                                Excluir da distribuição
                              </label>
                              <div
                                className={cn(
                                  "mt-1.5 overflow-hidden rounded-xl border",
                                  isLight ? "border-rose-200/80 bg-white" : "border-rose-800/60 bg-surface-deep/90",
                                )}
                                role="group"
                                aria-labelledby={`${formId}-exclude-form-label`}
                              >
                                <div className={cn("border-b", isLight ? "border-rose-200/80" : "border-rose-800/60")}>
                                  <div className="relative p-2 sm:p-2.5">
                                    <Search
                                      className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
                                      strokeWidth={2}
                                      aria-hidden
                                    />
                                    <Input
                                      id={`${formId}-exclude-form-search`}
                                      type="search"
                                      autoComplete="off"
                                      placeholder="Buscar formulário..."
                                      value={excludeFormPicker}
                                      disabled={formsLoading || !!formsError}
                                      onChange={(e) => setExcludeFormPicker(e.target.value)}
                                      className={cn(
                                        "h-11 rounded-xl pl-9 text-sm",
                                        isLight ? "border-rose-200/80 bg-white" : "border-rose-800/60 bg-surface-deep/90",
                                      )}
                                    />
                                  </div>
                                </div>
                                <ul
                                  className="max-h-60 overflow-y-auto overscroll-contain"
                                  role="listbox"
                                  aria-multiselectable="true"
                                  aria-label="Formulários a desconsiderar"
                                >
                                  {formsLoading ? (
                                    <li className="px-3 py-3.5 text-xs text-content-muted">Buscando formulários...</li>
                                  ) : formsError ? (
                                    <li
                                      className={cn(
                                        "px-3 py-3.5 text-xs font-medium",
                                        isLight ? "text-orange-700" : "text-orange-400",
                                      )}
                                    >
                                      {formsError}
                                    </li>
                                  ) : !availableForms.length ? (
                                    <li className="px-3 py-3.5 text-xs text-content-muted">
                                      Nenhum formulário encontrado nesta página
                                    </li>
                                  ) : (
                                    (() => {
                                      const query = normalizeFormSearchText(excludeFormPicker.trim());
                                      const filtered = availableForms.filter((f) => {
                                        if (!query) return true;
                                        const label = normalizeFormSearchText(f.form_name ?? f.form_id);
                                        return label.includes(query);
                                      });
                                      if (!filtered.length) {
                                        return (
                                          <li className="px-3 py-3.5 text-xs text-content-muted">
                                            Nenhum formulário encontrado para essa busca
                                          </li>
                                        );
                                      }
                                      return filtered.map((f, i) => {
                                        const selected = draft.excludedFormIds.includes(f.form_id);
                                        return (
                                          <li key={f.form_id} className="list-none">
                                            <button
                                              type="button"
                                              role="option"
                                              aria-selected={selected}
                                              onClick={() =>
                                                setDraft((d) => ({
                                                  ...d,
                                                  excludedFormIds: selected
                                                    ? d.excludedFormIds.filter((x) => x !== f.form_id)
                                                    : [...d.excludedFormIds, f.form_id],
                                                }))
                                              }
                                              className={cn(
                                                "flex w-full items-center gap-3 px-3 py-3 text-left transition sm:gap-3.5 sm:px-4 sm:py-3.5",
                                                i > 0 && (isLight ? "border-t border-rose-200/70" : "border-t border-rose-800/60"),
                                                selected
                                                  ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                                                  : isLight
                                                    ? "hover:bg-rose-50/80"
                                                    : "hover:bg-rose-950/40",
                                              )}
                                            >
                                              <span className="min-w-0 flex-1">
                                                <span className="block font-medium text-content">{f.form_name ?? f.form_id}</span>
                                                {f.form_name && f.form_name !== f.form_id ? (
                                                  <span className="mt-0.5 block truncate text-[11px] text-content-muted">
                                                    {f.form_id}
                                                  </span>
                                                ) : null}
                                              </span>
                                              {selected ? (
                                                <Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
                                              ) : null}
                                            </button>
                                          </li>
                                        );
                                      });
                                    })()
                                  )}
                                </ul>
                              </div>
                              {draft.excludedFormIds.length ? (
                                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Formulários excluídos">
                                  {draft.excludedFormIds.map((fid) => (
                                    <li
                                      key={fid}
                                      className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", isLight ? "border-rose-300/80 bg-white/90 text-rose-900" : "border-rose-800 bg-rose-950/40 text-rose-100")}
                                    >
                                      <span className="truncate">{metaFormLabel(fid)}</span>
                                      <button
                                        type="button"
                                        className={cn("ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition", isLight ? "text-rose-600 hover:bg-rose-100" : "text-rose-300 hover:bg-rose-900/60")}
                                        aria-label={`Remover ${metaFormLabel(fid)} da exclusão`}
                                        onClick={() =>
                                          setDraft((d) => ({
                                            ...d,
                                            excludedFormIds: d.excludedFormIds.filter((x) => x !== fid),
                                          }))
                                        }
                                      >
                                        ×
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {availableForms.length > 0 && availableForms.every((f) => draft.excludedFormIds.includes(f.form_id)) ? (
                                <p className={cn("mt-2 text-[11px]", isLight ? "text-rose-800/80" : "text-rose-300/90")}>Todos os formulários estão na lista de exclusão.</p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-line/80 bg-surface-deep/35 p-4">
                          <label
                            id={`${formId}-include-form-label`}
                            className="text-sm font-semibold text-content"
                            htmlFor={`${formId}-include-form-search`}
                          >
                            Formulários Específicos
                          </label>
                          <p className="mt-1 text-xs text-content-muted">
                            Escolha um ou mais formulários desta página. Só leads destes formulários serão tratados por esta regra.
                          </p>
                          <div
                            className="mt-3 overflow-hidden rounded-xl border border-line/80 bg-surface-deep/60"
                            role="group"
                            aria-labelledby={`${formId}-include-form-label`}
                          >
                            <div className="border-b border-line/70 p-2 sm:p-2.5">
                              <div className="relative">
                                <Search
                                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                                <Input
                                  id={`${formId}-include-form-search`}
                                  type="search"
                                  autoComplete="off"
                                  placeholder="Buscar formulário..."
                                  value={includeFormPicker}
                                  disabled={formsLoading || !!formsError}
                                  onChange={(e) => setIncludeFormPicker(e.target.value)}
                                  className="h-11 rounded-xl border-line bg-surface-card pl-9 text-sm"
                                />
                              </div>
                            </div>
                            <ul
                              className="max-h-52 overflow-y-auto overscroll-contain"
                              role="listbox"
                              aria-multiselectable="true"
                              aria-label="Formulários específicos"
                            >
                              {formsLoading ? (
                                <li className="px-3 py-3.5 text-xs text-content-muted">Buscando formulários...</li>
                              ) : formsError ? (
                                <li
                                  className={cn(
                                    "px-3 py-3.5 text-xs font-medium",
                                    isLight ? "text-orange-700" : "text-orange-400",
                                  )}
                                >
                                  {formsError}
                                </li>
                              ) : !availableForms.length ? (
                                <li className="px-3 py-3.5 text-xs text-content-muted">
                                  Nenhum formulário encontrado nesta página
                                </li>
                              ) : (
                                (() => {
                                  const query = normalizeFormSearchText(includeFormPicker.trim());
                                  const filtered = availableForms.filter((f) => {
                                    if (!query) return true;
                                    const label = normalizeFormSearchText(f.form_name ?? f.form_id);
                                    return label.includes(query);
                                  });
                                  if (!filtered.length) {
                                    return (
                                      <li className="px-3 py-3.5 text-xs text-content-muted">
                                        Nenhum formulário encontrado para essa busca
                                      </li>
                                    );
                                  }
                                  return filtered.map((f, i) => {
                                    const selected = draft.includedFormIds.includes(f.form_id);
                                    return (
                                      <li key={f.form_id} className="list-none">
                                        <button
                                          type="button"
                                          role="option"
                                          aria-selected={selected}
                                          onClick={() =>
                                            setDraft((d) => ({
                                              ...d,
                                              includedFormIds: selected
                                                ? d.includedFormIds.filter((x) => x !== f.form_id)
                                                : [...d.includedFormIds, f.form_id],
                                            }))
                                          }
                                          className={cn(
                                            "flex w-full items-center gap-3 px-3 py-3 text-left transition sm:gap-3.5 sm:px-4 sm:py-3.5",
                                            i > 0 && "border-t border-line/70",
                                            selected
                                              ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                                              : "hover:bg-surface-card/70",
                                          )}
                                        >
                                          <span className="min-w-0 flex-1">
                                            <span className="block font-medium text-content">{f.form_name ?? f.form_id}</span>
                                            {f.form_name && f.form_name !== f.form_id ? (
                                              <span className="mt-0.5 block truncate text-[11px] text-content-muted">
                                                {f.form_id}
                                              </span>
                                            ) : null}
                                          </span>
                                          {selected ? (
                                            <Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
                                          ) : null}
                                        </button>
                                      </li>
                                    );
                                  });
                                })()
                              )}
                            </ul>
                          </div>
                          {draft.includedFormIds.length ? (
                            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Formulários incluídos nesta regra">
                              {draft.includedFormIds.map((fid) => (
                                <li
                                  key={fid}
                                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-card px-2.5 py-1 text-xs font-medium text-content"
                                >
                                  <span className="truncate">{metaFormLabel(fid)}</span>
                                  <button
                                    type="button"
                                    className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-content-muted transition hover:bg-surface-deep hover:text-content"
                                    aria-label={`Remover ${metaFormLabel(fid)}`}
                                    onClick={() =>
                                      setDraft((d) => ({
                                        ...d,
                                        includedFormIds: d.includedFormIds.filter((x) => x !== fid),
                                      }))
                                    }
                                  >
                                    ×
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-[11px] font-medium text-amber-300/90">
                              Selecione pelo menos um formulário para avançar.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {draft.source === "meta_form" ? (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.05] p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">Conexão para o primeiro atendimento</p>
                <p className="mt-1 text-xs leading-relaxed">
                  Esta linha será usada somente por este formulário para a primeira mensagem automática. Ela não autoriza atendimento direto fora da campanha.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    { value: "evolution" as const, label: "QR Code / Evolution" },
                    { value: "cloud_api" as const, label: "Cloud API oficial" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          transport: option.value,
                          connectionId:
                            current.transport === option.value ? current.connectionId : "",
                          metaTemplateName:
                            option.value === "cloud_api" && current.transport === "cloud_api"
                              ? current.metaTemplateName
                              : "",
                        }))
                      }
                      className={cn(
                        "rounded-lg px-3 py-2 text-left text-xs font-semibold transition",
                        draft.transport === option.value
                          ? "bg-primary text-white"
                          : "bg-surface-card text-content hover:bg-surface-deep",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {draft.transport === "evolution" ? (
                  <div className="mt-3">
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                      Número / conexão WhatsApp
                    </label>
                    <select
                      value={draft.connectionId}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          transport: "evolution",
                          connectionId: event.target.value,
                          metaTemplateName: "",
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                    >
                      <option value="">Selecione uma conexão</option>
                      {whatsAppConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          Linha {connection.slot_index + 1} ·{" "}
                          {connection.wa_jid?.split("@")[0] || connection.instance_name}
                          {connection.connection_state === "open" ? " · conectada" : " · desconectada"}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-content-muted">
                      Obrigatória quando a regra atende com IA. Regras antigas sem conexão continuam visíveis, mas não
                      iniciam atendimento até serem corrigidas.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label
                        htmlFor={`${formId}-meta-cloud-connection`}
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-muted"
                      >
                        Número Cloud API
                      </label>
                      {cloudApiConnections.length === 0 ? (
                        <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          Nenhum número Cloud API conectado. Vá em Integrações → API Meta e conecte uma linha.
                        </p>
                      ) : (
                        <select
                          id={`${formId}-meta-cloud-connection`}
                          value={draft.connectionId}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              transport: "cloud_api",
                              connectionId: event.target.value,
                              metaTemplateName: "",
                            }))
                          }
                          className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                        >
                          <option value="">Selecione o número Cloud</option>
                          {cloudApiConnections.map((connection) => (
                            <option key={connection.connectionId} value={connection.connectionId}>
                              Linha {connection.slotIndex + 1} · {connection.label}
                              {connection.connected ? " · conectada" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor={`${formId}-meta-form-template`}
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-muted"
                      >
                        Template Meta aprovado (1º contacto Lead Ads)
                      </label>
                      {metaTemplatesLoading ? (
                        <p className="text-xs text-content-muted">A carregar templates…</p>
                      ) : draft.connectionId && metaTemplates.length === 0 ? (
                        <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          Nenhum modelo aprovado encontrado para este número. Aprove um template no Gerenciador da Meta
                          e volte aqui.
                        </p>
                      ) : (
                        <select
                          id={`${formId}-meta-form-template`}
                          value={draft.metaTemplateName}
                          onChange={(event) => {
                            const name = event.target.value;
                            const selected = metaTemplates.find((t) => t.name === name);
                            setDraft((current) => ({
                              ...current,
                              metaTemplateName: name,
                              metaTemplateLang: selected?.language ?? current.metaTemplateLang ?? "pt_BR",
                            }));
                          }}
                          className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                        >
                          <option value="">Selecione um modelo aprovado</option>
                          {metaTemplates.map((t) => (
                            <option key={t.name} value={t.name}>
                              {t.name}
                              {t.language ? ` · ${t.language}` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="mt-1.5 text-[11px] leading-relaxed text-content-muted">
                        Obrigatório pela Meta para o primeiro WhatsApp iniciado pela empresa. Sem template, o sistema
                        pode usar temporariamente o QR Code da mesma linha, se estiver conectado.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {draft.source === ORGANIC_WHATSAPP_SOURCE ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">Transporte do WhatsApp direto</p>
                <p className="mt-1 text-xs leading-relaxed">
                  O transporte conecta o número. Esta regra é o que autoriza o agente a responder mensagens espontâneas.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    { value: "evolution" as const, label: "QR Code / Evolution" },
                    { value: "cloud_api" as const, label: "Cloud API oficial" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          transport: option.value,
                          connectionId:
                            current.transport === option.value ? current.connectionId : "",
                          metaTemplateName:
                            option.value === "cloud_api" && current.transport === "cloud_api"
                              ? current.metaTemplateName
                              : "",
                        }))
                      }
                      className={cn(
                        "rounded-lg px-3 py-2 text-left text-xs font-semibold transition",
                        draft.transport === option.value
                          ? "bg-primary text-white"
                          : "bg-surface-card text-content hover:bg-surface-deep",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {draft.transport === "evolution" ? (
                  <div className="mt-3">
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                      Número / conexão autorizada
                    </label>
                    <select
                      value={draft.connectionId}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          connectionId: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                    >
                      <option value="">Selecione uma conexão</option>
                      {whatsAppConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          Linha {connection.slot_index + 1} ·{" "}
                          {connection.wa_jid?.split("@")[0] || connection.instance_name}
                          {connection.connection_state === "open" ? " · conectada" : " · desconectada"}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label
                        htmlFor={`${formId}-cloud-phone-number-id`}
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-muted"
                      >
                        Phone Number ID da Cloud API
                      </label>
                      <input
                        id={`${formId}-cloud-phone-number-id`}
                        value={draft.connectionId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            connectionId: event.target.value.replace(/\D/g, ""),
                            metaTemplateName: "",
                          }))
                        }
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="Ex.: 123456789012345"
                        className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                      />
                      <p className="mt-1.5 text-[11px] leading-relaxed text-content-muted">
                        Identificador do número em Integrações → API Meta (ou no painel da Meta).
                      </p>
                    </div>
                    <div>
                      <label
                        htmlFor={`${formId}-meta-template`}
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-muted"
                      >
                        Template Meta aprovado (1º contacto Lead Ads)
                      </label>
                      {metaTemplatesLoading ? (
                        <p className="text-xs text-content-muted">A carregar templates…</p>
                      ) : draft.connectionId && metaTemplates.length === 0 ? (
                        <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          Nenhum modelo aprovado encontrado para este número. Aprove um template no Gerenciador da
                          Meta e volte aqui.
                        </p>
                      ) : (
                        <select
                          id={`${formId}-meta-template`}
                          value={draft.metaTemplateName}
                          onChange={(event) => {
                            const name = event.target.value;
                            const selected = metaTemplates.find((t) => t.name === name);
                            setDraft((current) => ({
                              ...current,
                              metaTemplateName: name,
                              metaTemplateLang: selected?.language ?? current.metaTemplateLang ?? "pt_BR",
                            }));
                          }}
                          className="h-11 w-full rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                        >
                          <option value="">Selecione um modelo aprovado</option>
                          {metaTemplates.map((t) => (
                            <option key={t.name} value={t.name}>
                              {t.name}
                              {t.language ? ` · ${t.language}` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="mt-1.5 text-[11px] leading-relaxed text-content-muted">
                        Obrigatório pela política da Meta para o primeiro WhatsApp iniciado pela empresa (fora da
                        janela de 24h).
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div className="rounded-xl border border-line/80 bg-surface-card p-4 sm:p-5">
              <div className="flex items-start gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line/80 bg-surface-deep/40 text-content">
                  <Share2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </span>
                <p className="text-sm font-semibold leading-snug text-content">Configuração de Envio de Conversões</p>
              </div>
              <div className="mt-4">
                <Toggle
                  id={`${formId}-conversion-send`}
                  label="Habilitar o envio de conversões?"
                  checked={draft.conversionSendEnabled}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      conversionSendEnabled: v,
                      ...(!v ? { conversionPixelId: "", conversionApiSecret: "" } : {}),
                    }))
                  }
                />
              </div>
              {draft.conversionSendEnabled ? (
                <div className="mt-5 space-y-4 border-t border-line/60 pt-5">
                  <div>
                    <label className="text-xs font-semibold text-content" htmlFor={`${formId}-conversion-pixel`}>
                      Pixel ID
                    </label>
                    <Input
                      id={`${formId}-conversion-pixel`}
                      className="mt-2 h-11 rounded-xl"
                      value={draft.conversionPixelId}
                      onChange={(e) => setDraft((d) => ({ ...d, conversionPixelId: e.target.value }))}
                      placeholder="Informe o Pixel ID"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-content" htmlFor={`${formId}-conversion-access`}>
                      Chave de acesso (API de conversões)
                    </label>
                    <textarea
                      id={`${formId}-conversion-access`}
                      rows={4}
                      value={draft.conversionApiSecret}
                      onChange={(e) => setDraft((d) => ({ ...d, conversionApiSecret: e.target.value }))}
                      placeholder="Informe a chave de acesso"
                      autoComplete="off"
                      className={cn(
                        "mt-2 w-full resize-y rounded-xl border border-line/80 bg-surface-deep/80 px-3.5 py-2.5 text-sm text-content transition",
                        "placeholder:text-content-faint",
                        "hover:border-line",
                        "focus:border-primary/70 focus:bg-surface-deep focus:outline-none focus:ring-[3px] focus:ring-primary/15",
                      )}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-content">Mapeamento de campos</p>
                <p className="mt-1 text-xs leading-relaxed text-content-muted">
                  Os campos de cada formulário selecionado foram detectados automaticamente. Revise e ajuste se necessário.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={fieldsFetchLoading || (draft.source === "meta_form" && metaFormFieldGroups.length === 0 && !fieldsFetchError)}
                className="shrink-0"
                onClick={() => refazerMapeamentoAutomatico()}
              >
                Refazer mapeamento automático
              </Button>
            </div>

            {fieldsFetchLoading ? (
              <p className="flex items-center gap-2 rounded-xl border border-line/80 bg-surface-deep/20 px-3 py-3 text-sm text-content-muted">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                Buscando campos dos formulários...
              </p>
            ) : null}

            {fieldsFetchError ? (
              <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {fieldsFetchError}
              </p>
            ) : null}

            {!fieldsFetchLoading && metaFormFieldGroups.length > 0 ? (
              <div className="space-y-4">
                {metaFormFieldGroups.map((group) => {
                  const groupMappings = draft.mappings.filter(
                    (m) =>
                      m.kind === "form" &&
                      (m.formId === group.formId || (!m.formId && metaFormFieldGroups.length === 1)),
                  );
                  const health = mappingStepHealthByForm.find((h) => h.formId === group.formId);
                  return (
                    <section
                      key={group.formId}
                      className="rounded-xl border border-line/80 bg-surface-deep/10 p-3 sm:p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-line/60 pb-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-content">{group.formLabel}</p>
                          <p className="mt-0.5 text-[10px] text-content-faint">ID: {group.formId}</p>
                        </div>
                        {health ? (
                          <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-medium">
                            {health.hasNome ? (
                              <span className={isLight ? "text-emerald-700" : "text-emerald-300"}>✓ Nome</span>
                            ) : null}
                            {health.hasCelular ? (
                              <span className={isLight ? "text-emerald-700" : "text-emerald-300"}>✓ Celular</span>
                            ) : null}
                            {health.hasEmail ? (
                              <span className={isLight ? "text-emerald-700" : "text-emerald-300"}>✓ Email</span>
                            ) : null}
                            {!health.canAdvance ? (
                              <span className={isLight ? "text-amber-800" : "text-amber-200"}>
                                Mapeie celular ou email
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {groupMappings.length > 0 ? (
                        <ul className="space-y-2">
                          {groupMappings.map((m) => (
                            <MetaMappingRow
                              key={m.id}
                              m={m}
                              metaType={metaFieldTypeByKey.get(mappingLookupKey(m.sourceKey, m.formId ?? group.formId))}
                              onPickCrm={(crm) =>
                                setDraft((d) => ({
                                  ...d,
                                  mappings: d.mappings.map((x) => (x.id === m.id ? { ...x, crmField: crm } : x)),
                                }))
                              }
                            />
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-content-muted">Nenhum campo mapeável neste formulário.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : null}

            {!fieldsFetchLoading && metaFormFieldGroups.length === 0 && formMappings.length > 0 ? (
              <ul className="space-y-2">
                {formMappings.map((m) => (
                  <MetaMappingRow
                    key={m.id}
                    m={m}
                    metaType={metaFieldTypeByKey.get(mappingLookupKey(m.sourceKey, m.formId))}
                    onPickCrm={(crm) =>
                      setDraft((d) => ({
                        ...d,
                        mappings: d.mappings.map((x) => (x.id === m.id ? { ...x, crmField: crm } : x)),
                      }))
                    }
                  />
                ))}
              </ul>
            ) : null}

            {contextMappings.length > 0 ? (
              <details className="rounded-xl border border-line/80 bg-surface-deep/10 p-3 sm:p-4">
                <summary className="cursor-pointer text-xs font-semibold text-content marker:text-content-muted">
                  Campos de contexto (opcional) — {contextMappings.length}{" "}
                  {contextMappings.length === 1 ? "campo" : "campos"}
                </summary>
                <ul className="mt-3 space-y-2 border-t border-line/60 pt-3">
                  {contextMappings.map((m) => (
                    <MetaMappingRow
                      key={m.id}
                      m={m}
                      onPickCrm={(crm) =>
                        setDraft((d) => ({
                          ...d,
                          mappings: d.mappings.map((x) => (x.id === m.id ? { ...x, crmField: crm } : x)),
                        }))
                      }
                    />
                  ))}
                </ul>
              </details>
            ) : null}

            {draft.mappings.length > 0 ? (
              <div
                className={cn(
                  "rounded-xl border px-3 py-3 text-xs",
                  mappingStepHealth.warnEssential
                    ? "border-amber-500/40 bg-amber-500/10"
                    : "border-line/80 bg-surface-deep/15",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {mappingStepHealth.hasNome ? (
                    <span className={cn("font-medium", isLight ? "text-emerald-700" : "text-emerald-300")}>✓ Nome mapeado</span>
                  ) : null}
                  {mappingStepHealth.hasCelular ? (
                    <span className={cn("font-medium", isLight ? "text-emerald-700" : "text-emerald-300")}>✓ Celular mapeado</span>
                  ) : null}
                  {mappingStepHealth.hasEmail ? (
                    <span className={cn("font-medium", isLight ? "text-emerald-700" : "text-emerald-300")}>✓ Email mapeado</span>
                  ) : null}
                </div>
                {mappingStepHealth.warnEssential ? (
                  <p className={cn("mt-2 font-medium", isLight ? "text-amber-800" : "text-amber-200")}>
                    Recomendado: mapeie nome e celular para identificar o contacto no CRM.
                  </p>
                ) : null}
                {!mappingStepHealth.canAdvance ? (
                  <p className={cn("mt-2 font-medium", isLight ? "text-amber-800" : "text-amber-200")}>
                    Mapeie pelo menos celular ou email para continuar.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            {isOrganicWhatsApp ? (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-content-secondary">
                <p className="font-semibold text-content">Um único agente de IA</p>
                <p className="mt-1 text-xs leading-relaxed">
                  Contactos que chegam pelo WhatsApp <strong className="text-content">sem campanha paga</strong> seguem sempre para o mesmo agente, para não haver
                  duas IAs a responder ao mesmo número.
                </p>
              </div>
            ) : (
              <div className="relative">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-semibold text-content-muted" id={`${formId}-dist-label`}>
                    Tipo de distribuição <span className="text-primary">*</span>
                  </label>
                  <PanelHelp content={DISTRIBUTION_HELP.type} />
                </div>
                <button
                  ref={distButtonRef}
                  type="button"
                  id={`${formId}-dist`}
                  aria-haspopup="listbox"
                  aria-expanded={distPickerOpen}
                  aria-labelledby={`${formId}-dist-label ${formId}-dist`}
                  className="mt-2 flex w-full min-h-[52px] items-center justify-between gap-3 rounded-xl border border-line bg-surface-card px-3 py-2.5 text-left transition hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-4"
                  onClick={() => setDistPickerOpen((o) => !o)}
                >
                  <span className="min-w-0 flex-1">
                    {currentDistChoice ? (
                      <>
                        <span className="block text-sm font-semibold text-content">{currentDistChoice.label}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-content-muted">{currentDistChoice.hint}</span>
                      </>
                    ) : (
                      <>
                        <span className="block text-sm font-medium text-content-muted">Seleccione o tipo de distribuição…</span>
                        <span className="mt-0.5 block text-xs leading-snug text-content-faint">
                          Toque para ver opções de equipa humana e agentes de IA. Nada fica pré-seleccionado.
                        </span>
                      </>
                    )}
                  </span>
                  <Search className="h-4 w-4 shrink-0 text-content-muted" strokeWidth={2} aria-hidden />
                </button>
                {distPickerOpen && distPopoverRect && typeof document !== "undefined"
                  ? createPortal(
                      <PanelAppearancePortalBridge>
                        <div
                          ref={distPopoverRef}
                          role="listbox"
                          aria-label="Tipos de distribuição"
                          style={{
                            position: "fixed",
                            top: distPopoverRect.top,
                            left: distPopoverRect.left,
                            width: distPopoverRect.width,
                            maxHeight: distPopoverRect.maxHeight,
                            zIndex: 200,
                          }}
                          className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line/90 bg-surface-card"
                        >
                          <div className="shrink-0 border-b border-line/80 bg-surface-deep/40 p-2">
                            <Input
                              value={distQuery}
                              onChange={(e) => setDistQuery(e.target.value)}
                              placeholder="Pesquisar tipo…"
                              className="h-9 rounded-lg border-line text-sm"
                              autoComplete="off"
                            />
                          </div>
                          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                            {(["crm", "equipa", "ia"] as const).map((group) => {
                              const items = filteredDistChoices.filter((c) => c.group === group);
                              if (!items.length) return null;
                              return (
                                <li key={group} className="list-none">
                                  <p className={cn(typography.ui.overline, "px-3 pb-1 pt-2 text-content-faint")}>
                                    {group === "crm" ? "CRM" : group === "equipa" ? "Equipe humana" : "Agentes de IA"}
                                  </p>
                                  <ul className="pb-1">
                                    {items.map((c) => {
                                      const active = draft.distributionType === c.value;
                                      return (
                                        <li key={c.value}>
                                          <button
                                            type="button"
                                            role="option"
                                            aria-selected={active}
                                            className={cn(
                                              "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition sm:py-3",
                                              active ? "bg-primary/10 text-primary" : "text-content hover:bg-surface-deep/60",
                                            )}
                                            onClick={() => {
                                              setDraft((d) => ({
                                                ...d,
                                                distributionType: c.value,
                                                agentIds:
                                                  c.value === "specific_agents" || c.value === "automation_agent"
                                                    ? c.value === "automation_agent"
                                                      ? d.agentIds.slice(0, 1)
                                                      : d.agentIds
                                                    : [],
                                                employeeIds:
                                                  c.value === "specific_employees" || c.value === "round_robin_employees"
                                                    ? d.employeeIds
                                                    : [],
                                              }));
                                              setDistPickerOpen(false);
                                              setDistQuery("");
                                            }}
                                          >
                                            <span className="font-semibold leading-tight">{c.label}</span>
                                            <span className="text-[11px] leading-snug text-content-muted">{c.hint}</span>
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </PanelAppearancePortalBridge>,
                      document.body,
                    )
                  : null}
                <p className="mt-2 text-[11px] leading-relaxed text-content-muted">
                  Equipa humana: até{" "}
                  <span className="font-semibold text-content">
                    {MAX_ORG_DIRECTORS} diretores, {MAX_ORG_MANAGERS} gerentes e {MAX_ORG_SELLERS} vendedores
                  </span>{" "}
                  ({MAX_TEAM_EMPLOYEES} no total) em{" "}
                  <Link href="/dashboard/colaboradores" className="font-semibold text-primary underline-offset-2 hover:underline">
                    Colaboradores
                  </Link>
                  .
                </p>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-line bg-surface-deep/25 p-3">
              <p className="text-xs font-semibold text-content">Conflitos e continuidade</p>
              <p className="mt-1 text-[11px] leading-relaxed text-content-muted">
                Define qual jornada assume quando o mesmo telefone entra por outra campanha ou formulário.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] font-semibold text-content-muted" htmlFor={`${formId}-conflict-policy`}>
                      Política
                    </label>
                    <PanelHelp content={DISTRIBUTION_HELP.policy} />
                  </div>
                  <Select
                    id={`${formId}-conflict-policy`}
                    className="mt-1.5 rounded-xl"
                    value={draft.conflictPolicy}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        conflictPolicy: event.target.value as Draft["conflictPolicy"],
                      }))
                    }
                  >
                    <option value="latest_wins">Campanha explícita mais recente assume</option>
                    <option value="priority_wins">Regra de maior prioridade assume</option>
                    <option value="keep_until_inactive">Manter jornada até inatividade</option>
                    <option value="manual_review">Pausar e solicitar decisão humana</option>
                  </Select>
                </div>
                {draft.conflictPolicy === "keep_until_inactive" ? (
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] font-semibold text-content-muted" htmlFor={`${formId}-conflict-inactivity`}>
                        Inatividade em minutos
                      </label>
                      <PanelHelp content={DISTRIBUTION_HELP.inactivity} />
                    </div>
                    <Input
                      id={`${formId}-conflict-inactivity`}
                      type="number"
                      min={1}
                      className="mt-1.5 h-10 rounded-xl"
                      value={draft.conflictInactivityMinutes}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          conflictInactivityMinutes: Math.max(1, Number(event.target.value) || 1),
                        }))
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-line bg-surface-deep/25 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Toggle
                    id={`${formId}-redistribution`}
                    checked={draft.redistribution}
                    onChange={(checked) =>
                      setDraft((d) => ({
                        ...d,
                        redistribution: checked,
                        redistributionConfig: checked
                          ? d.redistributionConfig
                          : {
                              prazo_minutos: 5,
                              quantidade: 2,
                              tipo: "round_robin",
                              agent_ids: [],
                              employee_ids: [],
                              executar_anteriores: true,
                              triggers: {
                                agent_unavailable: true,
                                delivery_failed: true,
                                human_timeout: false,
                                customer_silence: false,
                              },
                              final_destination: "next_agent",
                            },
                      }))
                    }
                    label="Ativar redistribuição?"
                    description="Se o primeiro destino não avançar no prazo definido, a regra pode tentar outro destino."
                  />
                </div>
                <PanelHelp content={DISTRIBUTION_HELP.redistribution} className="mt-0.5" />
              </div>
              {draft.redistribution ? (
                <>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] font-semibold text-content-muted" htmlFor={`${formId}-redistribution-minutes`}>
                        Prazo em minutos
                      </label>
                      <PanelHelp content={DISTRIBUTION_HELP.deadline} />
                    </div>
                    <Input
                      id={`${formId}-redistribution-minutes`}
                      type="number"
                      min={1}
                      className="mt-1.5 h-10 rounded-xl"
                      value={draft.redistributionConfig.prazo_minutos}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          redistributionConfig: {
                            ...d.redistributionConfig,
                            prazo_minutos: Math.max(1, Number(e.target.value) || 5),
                          },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] font-semibold text-content-muted" htmlFor={`${formId}-redistribution-count`}>
                        Quantidade de tentativas
                      </label>
                      <PanelHelp content={DISTRIBUTION_HELP.attempts} />
                    </div>
                    <Input
                      id={`${formId}-redistribution-count`}
                      type="number"
                      min={1}
                      className="mt-1.5 h-10 rounded-xl"
                      value={draft.redistributionConfig.quantidade}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          redistributionConfig: {
                            ...d.redistributionConfig,
                            quantidade: Math.max(1, Number(e.target.value) || 2),
                          },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] font-semibold text-content-muted" htmlFor={`${formId}-redistribution-type`}>
                        Tipo de redistribuição
                      </label>
                      <PanelHelp content={DISTRIBUTION_HELP.redistributionType} />
                    </div>
                    <Select
                      id={`${formId}-redistribution-type`}
                      className="mt-1.5 h-10 rounded-xl"
                      value={draft.redistributionConfig.tipo}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          redistributionConfig: {
                            ...d.redistributionConfig,
                            tipo: e.target.value as LeadDistributionType,
                          },
                        }))
                      }
                    >
                      {ALL_DISTRIBUTION_CHOICES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1.5">
                  <p className="text-[11px] font-semibold text-content-muted">Quando redistribuir</p>
                  <PanelHelp content={DISTRIBUTION_HELP.triggers} />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {[
                    {
                      key: "agent_unavailable" as const,
                      label: "Agente desativado ou indisponível",
                    },
                    {
                      key: "delivery_failed" as const,
                      label: "Falha definitiva no envio",
                    },
                    {
                      key: "human_timeout" as const,
                      label: "Equipe humana não aceitou no prazo",
                    },
                    {
                      key: "customer_silence" as const,
                      label: "Cliente permaneceu em silêncio",
                    },
                  ].map((trigger) => (
                    <label
                      key={trigger.key}
                      className="flex items-center gap-2 rounded-lg bg-surface-card px-3 py-2 text-xs text-content"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={draft.redistributionConfig.triggers?.[trigger.key] === true}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            redistributionConfig: {
                              ...current.redistributionConfig,
                              triggers: {
                                agent_unavailable:
                                  current.redistributionConfig.triggers?.agent_unavailable ?? true,
                                delivery_failed:
                                  current.redistributionConfig.triggers?.delivery_failed ?? true,
                                human_timeout:
                                  current.redistributionConfig.triggers?.human_timeout ?? false,
                                customer_silence:
                                  current.redistributionConfig.triggers?.customer_silence ?? false,
                                [trigger.key]: event.target.checked,
                              },
                            },
                          }))
                        }
                      />
                      {trigger.label}
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] font-semibold text-content-muted" htmlFor={`${formId}-redistribution-final`}>
                      Destino final
                    </label>
                    <PanelHelp content={DISTRIBUTION_HELP.finalDestination} />
                  </div>
                  <Select
                    id={`${formId}-redistribution-final`}
                    className="mt-1.5 h-10 rounded-xl"
                    value={draft.redistributionConfig.final_destination ?? "next_agent"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        redistributionConfig: {
                          ...current.redistributionConfig,
                          final_destination: event.target.value as
                            | "next_agent"
                            | "human_team"
                            | "crm_only",
                        },
                      }))
                    }
                  >
                    <option value="next_agent">Próximo agente autorizado na regra</option>
                    <option value="human_team">Equipe humana</option>
                    <option value="crm_only">Somente CRM</option>
                  </Select>
                </div>
                </>
              ) : null}
            </div>

            {(draft.distributionType === "specific_agents" && !isOrganicWhatsApp) || isOrganicWhatsApp ? (
              <div className="mt-4 rounded-xl border border-line bg-surface-deep/25 p-3">
                <p className="text-xs font-medium text-content-muted">{isOrganicWhatsApp ? "Agente de destino" : "Agentes de IA de destino"}</p>
                <p className="mt-1 text-[11px] text-content-faint">
                  {isOrganicWhatsApp
                    ? "Selecione exatamente um agente em «Agentes». Esta origem não permite mais do que um."
                    : "Escolha um ou mais agentes configurados em «Agentes». A regra envia o contexto para o motor do agente."}
                </p>
                <ul className="mt-3 space-y-2">
                  {agents.map((a) => {
                    const checked = draft.agentIds.includes(a.id);
                    return (
                      <li key={a.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line/80 bg-surface-card px-3 py-2">
                          <input
                            type={isOrganicWhatsApp ? "radio" : "checkbox"}
                            name={isOrganicWhatsApp ? `${formId}-organic-agent` : `${formId}-ia-agents`}
                            className="h-4 w-4 border-line accent-primary"
                            checked={checked}
                            onChange={() =>
                              setDraft((d) => ({
                                ...d,
                                agentIds: isOrganicWhatsApp ? (checked ? [] : [a.id]) : checked ? d.agentIds.filter((id) => id !== a.id) : [...d.agentIds, a.id],
                              }))
                            }
                          />
                          <span className="text-sm text-content">{a.nome}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {draft.distributionType === "automation_agent" && !isOrganicWhatsApp ? (
              <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
                <p className="text-xs font-semibold text-primary">Agente de automação</p>
                <p className="mt-1 text-[11px] leading-relaxed text-content-secondary">
                  Escolha <strong className="text-content">um</strong> agente de IA. Ele recebe o lead assim que entra e dispara a{" "}
                  <strong className="text-content">primeira mensagem automática</strong> (conforme o fluxo e templates configurados em Agentes).
                </p>
                {agents.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-200">
                    Nenhum agente ativo encontrado neste tenant.{" "}
                    <Link href="/dashboard/agentes" className="font-semibold text-primary underline-offset-2 hover:underline">
                      Crie ou ative um agente em Agentes
                    </Link>{" "}
                    para liberar o atendimento automático.
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {agents.map((a) => {
                      const checked = draft.agentIds[0] === a.id;
                      return (
                        <li key={a.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line/80 bg-surface-card px-3 py-2 transition hover:border-primary/35 hover:bg-primary/[0.04]">
                            <input
                              type="radio"
                              name={`${formId}-automation-agent`}
                              className="h-4 w-4 border-line accent-primary"
                              checked={checked}
                              onChange={() => setDraft((d) => ({ ...d, agentIds: [a.id] }))}
                            />
                            <span className="text-sm text-content">{a.nome}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}

            {draft.distributionType === "specific_employees" || draft.distributionType === "round_robin_employees" ? (
              <div className="mt-4 rounded-xl border border-line bg-surface-deep/25 p-3">
                <p className="text-xs font-medium text-content-muted">
                  {draft.distributionType === "round_robin_employees" ? "Colaboradores na fila (plantão)" : "Colaboradores de destino"}
                </p>
                <p className="mt-1 text-[11px] text-content-faint">
                  {draft.distributionType === "round_robin_employees"
                    ? "Marque quem entra na rotação. Os leads são repartidos de forma equilibrada entre as pessoas seleccionadas."
                    : "Apenas os colaboradores marcados recebem notificação desta regra."}
                </p>
                {teamEmployees.length === 0 ? (
                  <p className="mt-3 text-xs font-medium text-amber-300/90">
                    Ainda não há colaboradores.{" "}
                    <Link href="/dashboard/colaboradores" className="text-primary underline-offset-2 hover:underline">
                      Adicione em Colaboradores
                    </Link>{" "}
                    (até mil registos).
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {teamEmployees.map((emp) => {
                      const checked = draft.employeeIds.includes(emp.id);
                      return (
                        <li key={emp.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line/80 bg-surface-card px-3 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 border-line accent-primary"
                              checked={checked}
                              onChange={() =>
                                setDraft((d) => ({
                                  ...d,
                                  employeeIds: checked ? d.employeeIds.filter((id) => id !== emp.id) : [...d.employeeIds, emp.id],
                                }))
                              }
                            />
                            <span className="min-w-0 flex-1 text-sm text-content">
                              <span className="font-medium">{emp.nome}</span>
                              {emp.funcao || emp.email ? (
                                <span className="mt-0.5 block truncate text-[11px] text-content-muted">
                                  {[emp.funcao, emp.email].filter(Boolean).join(" · ")}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}

            {draft.distributionType === "all_employees" && !isOrganicWhatsApp ? (
              <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3 text-sm text-content-secondary">
                {teamEmployees.length === 0 ? (
                  <p className="text-xs font-medium text-amber-200/90">
                    Sem colaboradores cadastrados.{" "}
                    <Link href="/dashboard/colaboradores" className="text-primary underline-offset-2 hover:underline">
                      Registe a equipa em Colaboradores
                    </Link>{" "}
                    para activar esta opção.
                  </p>
                ) : (
                  <p>
                    <strong className="text-content">Todos os {teamEmployees.length} colaborador(es)</strong> registados serão notificados quando um lead
                    corresponder a esta regra.
                  </p>
                )}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", isLight ? "border-emerald-500/25 bg-emerald-500/[0.07]" : "border-emerald-500/20 bg-emerald-500/10")}>
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white", isLight ? "bg-emerald-500" : "bg-emerald-600")}>
                <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cn("text-sm font-semibold", isLight ? "text-emerald-900" : "text-emerald-100")}>Resumo da configuração</p>
                <p className={cn("mt-1 text-xs leading-relaxed", isLight ? "text-emerald-900/80" : "text-emerald-100/85")}>
                  Revise tudo o que definiu nesta regra antes de criar ou guardar. Os valores abaixo reflectem o estado actual do assistente.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-line/80 bg-surface-deep/15 px-4 py-5 sm:px-6">
              <div className="flex flex-col gap-0">
                {/* timeline rows */}
                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-info ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Nome da regra</p>
                    <p className="mt-1 break-words text-sm font-semibold text-primary">{draft.name.trim() || "—"}</p>
                  </div>
                </div>

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-secondary ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Canal de entrada</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {draft.source === "meta_form" ? (
                        <span className="inline-flex items-center rounded-full border border-info/35 bg-info/10 px-2.5 py-0.5 text-xs font-semibold text-info">
                          Facebook · formulários
                        </span>
                      ) : draft.source === "whatsapp_api" ? (
                        <span className={cn("inline-flex items-center rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2.5 py-0.5 text-xs font-semibold", isLight ? "text-emerald-800" : "text-emerald-200")}>
                          WhatsApp Business · API
                        </span>
                      ) : draft.source === "whatsapp_qr" ? (
                        <span className={cn("inline-flex items-center rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2.5 py-0.5 text-xs font-semibold", isLight ? "text-emerald-800" : "text-emerald-200")}>
                          WhatsApp · QR Code
                        </span>
                      ) : (
                        <Badge className={cn("border-amber-500/40 bg-amber-500/10", isLight ? "text-amber-950" : "text-amber-100")}>
                          {sourceLabelOrPlaceholder(draft.source)}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-content-muted">
                      Sessão / conta de referência nesta demo: <span className="font-medium text-content">{displayName}</span>
                    </p>
                  </div>
                </div>

                {draft.source === "meta_form" ? (
                  <div className="flex gap-3.5">
                    <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary ring-2 ring-surface-card" aria-hidden />
                      <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 pb-8">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Página e formulários Meta</p>
                      <p className="mt-1 break-words text-sm font-semibold text-content">
                        Página: <span className="text-content">{draft.pageLabel.trim() || "—"}</span>
                      </p>
                      <div className="mt-2 rounded-lg border border-line/70 bg-surface-card/60 px-3 py-2 text-xs text-content-secondary">
                        {draft.useAllForms ? (
                          draft.excludedFormIds.length ? (
                            <span>
                              <span className="font-medium text-content">Todos os formulários</span>, excepto:{" "}
                              {draft.excludedFormIds.map(metaFormLabel).join(" · ")}
                            </span>
                          ) : (
                            <span className="font-medium text-content">Todos os formulários desta página</span>
                          )
                        ) : draft.includedFormIds.length ? (
                          <span>
                            <span className="font-medium text-content">Só estes formulários:</span>{" "}
                            {draft.includedFormIds.map(metaFormLabel).join(" · ")}
                          </span>
                        ) : (
                          <span className="text-content-muted">Nenhum conjunto de formulários seleccionado</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-secondary ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Mapeamento de campos</p>
                    {draft.mappings.length ? (
                      <div className="mt-2 max-h-64 space-y-3 overflow-y-auto overscroll-contain">
                        {metaFormFieldGroups.length > 0 ? (
                          metaFormFieldGroups.map((group) => {
                            const groupMappings = draft.mappings.filter(
                              (m) =>
                                m.kind === "form" &&
                                (m.formId === group.formId || (!m.formId && metaFormFieldGroups.length === 1)),
                            );
                            if (groupMappings.length === 0) return null;
                            return (
                              <div
                                key={group.formId}
                                className="rounded-lg border border-line/70 bg-surface-card/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed"
                              >
                                <p className="mb-1.5 font-sans text-xs font-semibold text-content">{group.formLabel}</p>
                                {groupMappings.map((m) => (
                                  <div key={m.id} className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                                    <span className="font-medium text-primary" title={m.sourceLabel}>
                                      {m.sourceKey}
                                    </span>
                                    <ArrowRight className="inline h-3 w-3 shrink-0 text-content-faint" aria-hidden />
                                    <span className="font-medium text-content">
                                      {CRM_FIELD_OPTIONS.find((c) => c.value === m.crmField)?.label ?? m.crmField}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })
                        ) : (
                          <div className="max-h-52 space-y-1.5 overflow-y-auto overscroll-contain rounded-lg border border-line/70 bg-surface-card/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
                            {draft.mappings.map((m) => (
                              <div key={m.id} className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                                <span className="font-medium text-primary" title={m.sourceLabel}>
                                  {m.sourceKey}
                                </span>
                                <ArrowRight className="inline h-3 w-3 shrink-0 text-content-faint" aria-hidden />
                                <span className="font-medium text-content">
                                  {CRM_FIELD_OPTIONS.find((c) => c.value === m.crmField)?.label ?? m.crmField}
                                </span>
                                <span className="w-full pl-0 text-[10px] font-normal text-content-faint sm:inline sm:w-auto sm:pl-1">
                                  ({m.kind === "context" ? "contexto" : "formulário"})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {contextMappings.length > 0 ? (
                          <div className="rounded-lg border border-line/70 bg-surface-card/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
                            <p className="mb-1.5 font-sans text-xs font-semibold text-content-muted">Campos de contexto</p>
                            {contextMappings.map((m) => (
                              <div key={m.id} className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                                <span className="font-medium text-primary" title={m.sourceLabel}>
                                  {m.sourceKey}
                                </span>
                                <ArrowRight className="inline h-3 w-3 shrink-0 text-content-faint" aria-hidden />
                                <span className="font-medium text-content">
                                  {CRM_FIELD_OPTIONS.find((c) => c.value === m.crmField)?.label ?? m.crmField}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-content-muted">Sem mapeamentos — opcional na demo; volte ao passo «Mapeamento» se quiser definir.</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-info ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Condições</p>
                    <div className="mt-2 rounded-lg border border-line/70 bg-surface-card/60 px-3 py-2 text-xs text-content-secondary">
                      Nesta versão de demonstração não há editor de condições: a regra aplica-se a todos os leads da origem escolhida. Em produção, filtraria aqui por
                      atributos do lead.
                    </div>
                  </div>
                </div>

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Tipo de distribuição</p>
                    <p className="mt-1 text-sm font-bold text-content">
                      {draft.distributionType ? distributionLabel(draft.distributionType) : "Ainda não seleccionado"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-secondary ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Agentes de IA</p>
                    {draft.distributionType === "specific_agents" || draft.distributionType === "automation_agent" || isOrganicWhatsApp ? (
                      draft.agentIds.length ? (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {draft.agentIds.map((id) => {
                            const nome = agents.find((a) => a.id === id)?.nome;
                            if (!nome) return null;
                            return (
                              <li
                                key={id}
                                className="inline-flex max-w-full items-center truncate rounded-full border border-brand-secondary/30 bg-brand-secondary/10 px-2.5 py-0.5 text-xs font-medium text-brand-secondary dark:text-content-secondary"
                              >
                                {nome}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs font-medium text-amber-300/90">Nenhum agente seleccionado — ajuste no passo «Distribuição».</p>
                      )
                    ) : (
                      <p className="mt-2 text-xs text-content-muted">
                        Não aplica agentes de IA específicos com o tipo de distribuição actual (
                        {draft.distributionType ? distributionLabel(draft.distributionType) : "—"}).
                      </p>
                    )}
                  </div>
                </div>

                {draft.distributionType === "specific_employees" ||
                draft.distributionType === "round_robin_employees" ||
                draft.distributionType === "all_employees" ? (
                  <div className="flex gap-3.5">
                    <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-teal-400 ring-2 ring-surface-card" aria-hidden />
                      <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 pb-8">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Colaboradores</p>
                      {draft.distributionType === "all_employees" ? (
                        <p className="mt-1 text-sm text-content">
                          Todos os <strong>{teamEmployees.length}</strong> registados em Colaboradores.
                        </p>
                      ) : draft.employeeIds.length ? (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {draft.employeeIds.map((id) => {
                            const nome = teamEmployees.find((e) => e.id === id)?.nome;
                            if (!nome) return null;
                            return (
                              <li
                                key={id}
                                className="inline-flex max-w-full items-center truncate rounded-full border border-teal-400/30 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-200"
                              >
                                {nome}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs font-medium text-amber-300/90">Nenhum colaborador seleccionado.</p>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500 ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Redistribuição</p>
                    <p className="mt-1 text-sm font-bold text-content">{draft.redistribution ? "Sim" : "Não"}</p>
                    <p className="mt-1 text-[11px] text-content-muted">Controlado automaticamente em algumas origens (ex.: WhatsApp orgânico).</p>
                  </div>
                </div>

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 ring-2 ring-surface-card" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Envio de conversões</p>
                    <div className="mt-2 rounded-lg border border-line/70 bg-surface-card/60 px-3 py-2 text-xs text-content-secondary">
                      {draft.conversionSendEnabled ? (
                        <span>
                          <strong className="text-content">Ligado</strong>
                          {draft.conversionPixelId.trim() ? (
                            <>
                              {" "}
                              · Pixel <span className="font-mono text-[11px] text-content">{draft.conversionPixelId.trim()}</span>
                            </>
                          ) : null}
                          {draft.conversionApiSecret.trim() ? " · chave de acesso definida" : null}
                        </span>
                      ) : (
                        <span className="text-content-muted">Desligado</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", isLight ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-950" : "border-emerald-500/25 bg-emerald-950/30 text-emerald-50")}>
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white", isLight ? "bg-emerald-500" : "bg-emerald-600")}>
                <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
              </span>
              <div>
                <p className={cn("text-sm font-bold", isLight ? "text-emerald-900" : "text-emerald-100")}>Configuração concluída</p>
                <p className="mt-0.5 text-xs leading-relaxed opacity-90">Todas as secções foram definidas — pode criar ou guardar a regra.</p>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
