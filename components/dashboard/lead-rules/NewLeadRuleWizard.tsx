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
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/types";
import {
  ORGANIC_WHATSAPP_SOURCE,
  distributionLabel,
  sourceLabel,
  type LeadDistributionRule,
  type LeadDistributionType,
  type LeadFieldMapping,
  type LeadRuleSource,
} from "@/lib/lead-distribution-rules";
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

/** Páginas de exemplo para o passo 1 (demo); em produção viriam da Meta OAuth. */
const FACEBOOK_DEMO_PAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "Página principal (demo)", label: "Página principal" },
  { value: "Página da marca", label: "Página da marca" },
  { value: "Campanhas · Lead Ads", label: "Campanhas · Lead Ads" },
  { value: "Atendimento comercial", label: "Atendimento comercial" },
];

/** Formulários de exemplo da página (demo); em produção viriam da Meta. */
const DEMO_META_FORM_OPTIONS: { id: string; label: string }[] = [
  { id: "demo-form-orcamento", label: "Pedido de orçamento" },
  { id: "demo-form-newsletter", label: "Newsletter / conteúdos" },
  { id: "demo-form-agendamento", label: "Agendamento comercial" },
  { id: "demo-form-suporte", label: "Suporte técnico" },
  { id: "demo-form-parceiros", label: "Parcerias B2B" },
];

function demoMetaFormLabel(id: string): string {
  return DEMO_META_FORM_OPTIONS.find((f) => f.id === id)?.label ?? id;
}

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

const CONTEXT_FIELDS: { key: string; label: string }[] = [
  { key: "form_name", label: "Nome do formulário (form_name)" },
  { key: "page_name", label: "Nome da página (page_name)" },
  { key: "campaign_name", label: "Nome da campanha (campaign_name)" },
  { key: "ad_name", label: "Nome do anúncio (ads_name)" },
];

function catalogForSource(source: LeadRuleSource | null): { key: string; label: string }[] {
  if (source === "meta_form") return META_LEAD_FORM_FIELD_CATALOG;
  if (source === "whatsapp_api" || source === "whatsapp_qr" || source === ORGANIC_WHATSAPP_SOURCE) return WHATSAPP_LEAD_FIELD_CATALOG;
  return GENERIC_LEAD_FIELD_CATALOG;
}

/** Sugere campo de CRM com base na chave técnica do payload (heurística demo). */
function inferCrmTarget(sourceKey: string): string {
  const k = sourceKey.toLowerCase();
  if (k.includes("email") || k.endsWith("_mail")) return "email";
  if (/(phone|tel|mobile|cell|wa_from|numero)/.test(k)) return "celular";
  if (/(full_name|first_name|last_name|profile_name|display_name|^nome)/.test(k)) return "nome";
  if (/(company|business|employer|empresa|org_name)/.test(k)) return "empresa";
  if (/(job_title|cargo|title)/.test(k)) return "empresa";
  if (/(form_name|page_name|campaign|ad_name|adset|utm_|timestamp|referral|payload|channel)/.test(k)) return "mensagem";
  if (/(address|morada|city|cidade|postal|zip|country|pais|state|estado)/.test(k)) return "mensagem";
  if (/(note|message|body|mensagem|coment|observ|topic|assunto|extra_|privacy|revenue|budget)/.test(k)) return "mensagem";
  return "mensagem";
}

function MappingRowCard({ m, onPickCrm }: { m: LeadFieldMapping; onPickCrm: (crm: string) => void }) {
  const Icon = CRM_ICONS[m.crmField] ?? MessageCircle;
  const showKeySuffix = !m.sourceLabel.toLowerCase().includes(`(${m.sourceKey.toLowerCase()})`);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface-deep/20 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-content">
          {m.sourceLabel}
          {showKeySuffix ? <span className="font-normal text-content-muted"> ({m.sourceKey})</span> : null}
        </p>
        <p className="text-[10px] text-content-faint">
          {m.kind === "context" ? "Campo de contexto" : "Campo do formulário"} · {m.sourceKey}
        </p>
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
          <Select aria-label={`CRM para ${m.sourceKey}`} className="min-h-[44px] flex-1" value={m.crmField} onChange={(e) => onPickCrm(e.target.value)}>
            {CRM_FIELD_OPTIONS.map((o) => (
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
  group: "equipa" | "ia";
}[] = [
  {
    value: "entry_owner",
    group: "equipa",
    label: "Responsável pela entrada",
    hint: "Quem captou ou ficou associado ao contacto na origem (qualquer sector).",
  },
  {
    value: "round_robin_employees",
    group: "equipa",
    label: "Rodízio na equipa (plantão / fila)",
    hint: "Alterna entre os colaboradores que selecionar — útil para filas de atendimento.",
  },
  {
    value: "all_employees",
    group: "equipa",
    label: "Todos os colaboradores",
    hint: "Todos os registos activos em Colaboradores podem receber o lead.",
  },
  {
    value: "specific_employees",
    group: "equipa",
    label: "Colaboradores selecionados",
    hint: "Apenas as pessoas que marcar na lista (definidas em Colaboradores).",
  },
  {
    value: "automation_agent",
    group: "ia",
    label: "Agente de automação",
    hint: "Um agente de IA recebe o lead e envia a primeira mensagem automática ao contacto.",
  },
  {
    value: "round_robin",
    group: "ia",
    label: "Rodízio entre agentes de IA",
    hint: "Distribui entre os agentes configurados em Agentes.",
  },
  {
    value: "all_agents",
    group: "ia",
    label: "Todos os agentes de IA",
    hint: "Todos os agentes activos podem processar o contexto do lead.",
  },
  {
    value: "specific_agents",
    group: "ia",
    label: "Agentes de IA selecionados",
    hint: "Escolha um ou mais agentes na lista abaixo.",
  },
];

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
  pageLabel: string;
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
};

function sourceLabelOrPlaceholder(s: LeadRuleSource | null): string {
  if (!s) return "Ainda não escolhida";
  return sourceLabel(s);
}

const emptyDraft = (): Draft => ({
  name: "",
  redistribution: false,
  source: null,
  pageLabel: "",
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
});

function ruleToDraft(r: LeadDistributionRule): Draft {
  return {
    name: r.name,
    redistribution: r.redistribution,
    source: r.source,
    pageLabel: r.pageLabel ?? "",
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
  const [mapBannerOpen, setMapBannerOpen] = useState(true);
  const [manualSource, setManualSource] = useState("");
  const [manualCrm, setManualCrm] = useState("");
  const [excludeFormPicker, setExcludeFormPicker] = useState("");
  const [includeFormPicker, setIncludeFormPicker] = useState("");
  const [distPickerOpen, setDistPickerOpen] = useState(false);
  const [distQuery, setDistQuery] = useState("");
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
    setMapBannerOpen(true);
    setManualSource("");
    setManualCrm("");
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
    const opts = [...FACEBOOK_DEMO_PAGE_OPTIONS];
    if (draft.pageLabel.trim() && !opts.some((o) => o.value === draft.pageLabel)) {
      opts.push({ value: draft.pageLabel, label: draft.pageLabel });
    }
    return opts;
  }, [draft.pageLabel]);

  const applyAutoMap = useCallback(() => {
    const src = draft.source;
    const formCatalog = catalogForSource(src);
    const base: LeadFieldMapping[] = formCatalog.map((f) => ({
      id: mappingId(),
      sourceKey: f.key,
      sourceLabel: f.label,
      kind: "form" as const,
      crmField: inferCrmTarget(f.key),
    }));
    const ctx: LeadFieldMapping[] =
      src === "meta_form"
        ? CONTEXT_FIELDS.map((c) => ({
            id: mappingId(),
            sourceKey: c.key,
            sourceLabel: c.label,
            kind: "context" as const,
            crmField: inferCrmTarget(c.key),
          }))
        : [];
    setDraft((d) => ({ ...d, mappings: [...base, ...ctx] }));
    setMapBannerOpen(true);
  }, [draft.source]);

  /** Ao entrar em Mapeamento vindo da Entrada: preenche o catálogo automaticamente se ainda não houver linhas (evita esquecimento; regras já com mapeamento não são sobrescritas). */
  useEffect(() => {
    if (!open) return;
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (step !== 1 || prev !== 0) return;
    if (!draft.source) return;
    if (draft.mappings.length > 0) return;
    applyAutoMap();
  }, [open, step, draft.source, draft.mappings.length, applyAutoMap]);

  const formMappings = useMemo(() => draft.mappings.filter((m) => m.kind === "form"), [draft.mappings]);
  const contextMappings = useMemo(() => draft.mappings.filter((m) => m.kind === "context"), [draft.mappings]);

  const mappingStepHealth = useMemo(() => {
    const hasNome = draft.mappings.some((m) => m.crmField === "nome");
    const hasCelular = draft.mappings.some((m) => m.crmField === "celular");
    const hasEmail = draft.mappings.some((m) => m.crmField === "email");
    const ready = hasNome && (hasCelular || hasEmail);
    return { hasNome, hasCelular, hasEmail, ready };
  }, [draft.mappings]);

  const demoCatalogCoverage = useMemo(() => {
    if (!draft.source) return { expected: 0, matched: 0 };
    const form = catalogForSource(draft.source);
    const ctx = draft.source === "meta_form" ? CONTEXT_FIELDS : [];
    const keys = new Set([...form.map((f) => f.key), ...ctx.map((c) => c.key)]);
    const matched = [...keys].filter((k) => draft.mappings.some((m) => m.sourceKey === k)).length;
    return { expected: keys.size, matched };
  }, [draft.mappings, draft.source]);

  const filteredDistChoices = useMemo(() => {
    const q = distQuery.trim().toLowerCase();
    return DISTRIBUTION_CHOICES.filter((c) => !q || `${c.label} ${c.hint}`.toLowerCase().includes(q));
  }, [distQuery]);

  const currentDistChoice = useMemo(() => {
    if (!draft.distributionType) return null;
    return DISTRIBUTION_CHOICES.find((c) => c.value === draft.distributionType) ?? null;
  }, [draft.distributionType]);

  const canAdvance = useMemo(() => {
    if (step === 0) {
      const base = draft.name.trim().length >= 2 && draft.source !== null;
      if (draft.source === "meta_form") {
        if (!draft.pageLabel.trim()) return false;
        if (!draft.useAllForms && draft.includedFormIds.length === 0) return false;
      }
      return base;
    }
    if (step === 2) {
      if (isOrganicWhatsApp) return draft.agentIds.length === 1;
      if (!draft.distributionType) return false;
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
    draft.distributionType,
    draft.employeeIds.length,
    draft.includedFormIds.length,
    draft.name,
    draft.pageLabel,
    draft.source,
    draft.useAllForms,
    isOrganicWhatsApp,
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
    if (draft.source === "meta_form" && !draft.pageLabel.trim()) {
      setStep(0);
      return;
    }
    if (draft.source === "meta_form" && !draft.useAllForms && draft.includedFormIds.length === 0) {
      setStep(0);
      return;
    }
    if (initialRule && onUpdated) {
      const rule: LeadDistributionRule = {
        ...initialRule,
        name: draft.name.trim(),
        source: draft.source,
        redistribution: draft.redistribution,
        distributionType: dist,
        agentIds:
          dist === "specific_agents"
            ? [...draft.agentIds]
            : dist === "automation_agent"
              ? draft.agentIds.slice(0, 1)
              : [],
        mappings: draft.mappings,
        pageLabel: draft.pageLabel,
        useAllForms: draft.useAllForms,
        excludedFormIds: draft.useAllForms ? [...draft.excludedFormIds] : [],
        includedFormIds: !draft.useAllForms ? [...draft.includedFormIds] : [],
        conversionSendEnabled: draft.conversionSendEnabled,
        conversionPixelId: draft.conversionSendEnabled ? draft.conversionPixelId.trim() : "",
        conversionApiSecret: draft.conversionSendEnabled ? draft.conversionApiSecret : "",
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
      redistribution: draft.redistribution,
      distributionType: dist,
      agentIds:
        dist === "specific_agents" ? [...draft.agentIds] : dist === "automation_agent" ? draft.agentIds.slice(0, 1) : [],
      mappings: draft.mappings,
      pageLabel: draft.pageLabel,
      useAllForms: draft.useAllForms,
      excludedFormIds: draft.useAllForms ? [...draft.excludedFormIds] : [],
      includedFormIds: !draft.useAllForms ? [...draft.includedFormIds] : [],
      conversionSendEnabled: draft.conversionSendEnabled,
      conversionPixelId: draft.conversionSendEnabled ? draft.conversionPixelId.trim() : "",
      conversionApiSecret: draft.conversionSendEnabled ? draft.conversionApiSecret : "",
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
                      id: "whatsapp_api" as const,
                      title: "WhatsApp Business",
                      sub: "API oficial da Meta",
                      iconBg: isLight ? "bg-emerald-500/15 text-emerald-600" : "bg-emerald-500/15 text-emerald-300",
                    },
                    {
                      id: "whatsapp_qr" as const,
                      title: "WhatsApp",
                      sub: "Ligação por QR Code",
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
                        setDraft((d) => ({ ...d, source: card.id }));
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
                        {card.id === "whatsapp_api" ? (
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
              {draft.source === ORGANIC_WHATSAPP_SOURCE || draft.source === "other" ? (
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
                    Nada vem pré-selecionado — toque na página vinculada de onde quer puxar os formulários (lista de demonstração).
                  </p>
                  <div
                    className="mt-3 overflow-hidden rounded-xl border border-line/80 bg-surface-deep/60"
                    role="radiogroup"
                    aria-labelledby={`${formId}-fb-page-label`}
                  >
                    {facebookPageSelectOptions.map((o, i) => {
                      const selected = draft.pageLabel === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setDraft((d) => ({ ...d, pageLabel: o.value }))}
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
                  {!draft.pageLabel.trim() ? (
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
                              <label className={cn("mt-3 block text-[11px] font-medium", isLight ? "text-rose-900/80" : "text-rose-200/90")} htmlFor={`${formId}-exclude-form`}>
                                Excluir da distribuição
                              </label>
                              <Select
                                id={`${formId}-exclude-form`}
                                className={cn("mt-1.5", isLight ? "border-rose-200/80 bg-white" : "border-rose-800/60 bg-surface-deep/90")}
                                value={excludeFormPicker}
                                onChange={(e) => {
                                  const id = e.target.value;
                                  if (!id) {
                                    setExcludeFormPicker("");
                                    return;
                                  }
                                  setDraft((d) =>
                                    d.excludedFormIds.includes(id)
                                      ? d
                                      : { ...d, excludedFormIds: [...d.excludedFormIds, id] },
                                  );
                                  setExcludeFormPicker("");
                                }}
                              >
                                <option value="">Selecionar formulários para excluir</option>
                                {DEMO_META_FORM_OPTIONS.filter((f) => !draft.excludedFormIds.includes(f.id)).map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.label}
                                  </option>
                                ))}
                              </Select>
                              {draft.excludedFormIds.length ? (
                                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Formulários excluídos">
                                  {draft.excludedFormIds.map((fid) => (
                                    <li
                                      key={fid}
                                      className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", isLight ? "border-rose-300/80 bg-white/90 text-rose-900" : "border-rose-800 bg-rose-950/40 text-rose-100")}
                                    >
                                      <span className="truncate">{demoMetaFormLabel(fid)}</span>
                                      <button
                                        type="button"
                                        className={cn("ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition", isLight ? "text-rose-600 hover:bg-rose-100" : "text-rose-300 hover:bg-rose-900/60")}
                                        aria-label={`Remover ${demoMetaFormLabel(fid)} da exclusão`}
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
                              {DEMO_META_FORM_OPTIONS.every((f) => draft.excludedFormIds.includes(f.id)) ? (
                                <p className={cn("mt-2 text-[11px]", isLight ? "text-rose-800/80" : "text-rose-300/90")}>Todos os formulários demo estão na lista de exclusão.</p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-line/80 bg-surface-deep/35 p-4">
                          <label className="text-sm font-semibold text-content" htmlFor={`${formId}-include-form`}>
                            Formulários Específicos
                          </label>
                          <p className="mt-1 text-xs text-content-muted">
                            Escolha um ou mais formulários desta página. Só leads destes formulários serão tratados por esta regra.
                          </p>
                          <Select
                            id={`${formId}-include-form`}
                            className="mt-3 h-11 rounded-xl"
                            value={includeFormPicker}
                            onChange={(e) => {
                              const id = e.target.value;
                              if (!id) {
                                setIncludeFormPicker("");
                                return;
                              }
                              setDraft((d) =>
                                d.includedFormIds.includes(id)
                                  ? d
                                  : { ...d, includedFormIds: [...d.includedFormIds, id] },
                              );
                              setIncludeFormPicker("");
                            }}
                          >
                            <option value="">Selecione formulários específicos</option>
                            {DEMO_META_FORM_OPTIONS.filter((f) => !draft.includedFormIds.includes(f.id)).map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.label}
                              </option>
                            ))}
                          </Select>
                          {draft.includedFormIds.length ? (
                            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Formulários incluídos nesta regra">
                              {draft.includedFormIds.map((fid) => (
                                <li
                                  key={fid}
                                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-card px-2.5 py-1 text-xs font-medium text-content"
                                >
                                  <span className="truncate">{demoMetaFormLabel(fid)}</span>
                                  <button
                                    type="button"
                                    className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-content-muted transition hover:bg-surface-deep hover:text-content"
                                    aria-label={`Remover ${demoMetaFormLabel(fid)}`}
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

            {draft.source === "whatsapp_api" ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">WhatsApp Business (API)</p>
                <p className="mt-1 text-xs leading-relaxed">
                  Ideal para número verificado, templates e volume. Confirme em{" "}
                  <Link href="/dashboard/integracoes#canal-whatsapp" className="font-semibold text-primary underline-offset-2 hover:underline">
                    Integrações
                  </Link>{" "}
                  se escolheu a API oficial no assistente WhatsApp.
                </p>
              </div>
            ) : null}

            {draft.source === "whatsapp_qr" ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm text-content-secondary">
                <p className="font-medium text-content">WhatsApp por QR Code</p>
                <p className="mt-1 text-xs leading-relaxed">
                  Bom para testar rápido no telemóvel. O mesmo ecrã de Integrações deixa escolher QR ou API — use o que estiver ligado à empresa.
                </p>
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
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.08] text-primary">
                <FileText className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-content">Configure o mapeamento de campos</p>
                <p className="mt-1 text-xs leading-relaxed text-content-muted">
                  {draft.source === "meta_form"
                    ? "Conecte cada chave que o formulário e a campanha enviam ao CRM. «Mapear automaticamente» gera uma linha por campo do catálogo demo; ajuste ou acrescente chaves reais da sua integração."
                    : draft.source === "whatsapp_api" || draft.source === "whatsapp_qr"
                      ? "Ligue perfil, número, texto e metadados do WhatsApp aos campos do CRM. O catálogo demo cobre o que costuma vir no webhook; use linhas manuais para o resto."
                      : "Ligue os identificadores que a origem expõe aos campos do CRM. Campos extra podem ser adicionados manualmente."}
                </p>
              </div>
            </div>
            {mapBannerOpen ? (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  "rounded-xl border-2 px-3 py-3",
                  isLight
                    ? "border-red-600/85 bg-red-50 text-red-950 ring-2 ring-red-500/35"
                    : "border-red-500/70 bg-red-950/50 text-red-50 ring-2 ring-red-400/30",
                  "motion-reduce:animate-none motion-safe:animate-pulse",
                )}
              >
                <p className={cn("text-sm font-bold tracking-tight", isLight ? "text-red-900" : "text-red-100")}>
                  Mapeamento automático (catálogo completo)
                </p>
                <p className={cn("mt-1 text-xs font-medium leading-relaxed", isLight ? "text-red-900/90" : "text-red-100/90")}>
                  Ao entrar neste passo, o catálogo é aplicado <strong className="font-bold">automaticamente</strong> quando ainda não havia linhas — ajuste cada linha em baixo ou toque outra vez em
                  «Mapear automaticamente» para refazer. Em produção, use as chaves reais da Meta ou do WhatsApp —{" "}
                  <strong className="font-bold">revise antes de publicar.</strong>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className={cn("font-semibold", isLight ? "border-red-800/25 bg-white text-red-900 hover:bg-red-50" : "border-red-300/20 bg-red-950/80 text-red-50 hover:bg-red-900/60")}
                    onClick={applyAutoMap}
                  >
                    Mapear automaticamente
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn("font-semibold", isLight ? "text-red-900 hover:bg-red-100/80" : "text-red-100 hover:bg-red-900/50")}
                    onClick={() => setMapBannerOpen(false)}
                  >
                    Entendi, vou revisar
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-content-faint">Mapeamento de campos</p>
              <Button type="button" size="sm" variant="outline" onClick={applyAutoMap}>
                Mapear automaticamente
              </Button>
            </div>
            <ul className="space-y-2">
              {formMappings.map((m) => (
                <MappingRowCard
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
            {contextMappings.length ? (
              <details className="rounded-xl border border-line/80 bg-surface-deep/10 p-3 sm:p-4" open>
                <summary className="cursor-pointer text-xs font-semibold text-content marker:text-content-muted">
                  Campos de contexto (opcional) — {contextMappings.length}{" "}
                  {contextMappings.length === 1 ? "campo" : "campos"}
                </summary>
                <ul className="mt-3 space-y-2 border-t border-line/60 pt-3">
                  {contextMappings.map((m) => (
                    <MappingRowCard
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
            <div className="rounded-xl border border-dashed border-line bg-surface-deep/20 p-3">
              <p className="text-xs font-medium text-content-muted">Adicionar mapeamento manual</p>
              <p className="mt-0.5 text-[11px] text-content-faint">
                Use a chave exacta que o fornecedor envia no JSON (ex.: campo personalizado do formulário).
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  placeholder="Nome ou chave do campo na origem"
                  value={manualSource}
                  onChange={(e) => setManualSource(e.target.value)}
                  className="sm:flex-1"
                />
                <span className="hidden text-content-faint sm:inline" aria-hidden>
                  →
                </span>
                <Select
                  aria-label="Campo do CRM"
                  value={manualCrm || "nome"}
                  onChange={(e) => setManualCrm(e.target.value)}
                  className="sm:flex-1"
                >
                  {CRM_FIELD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const key = manualSource.trim();
                    if (!key) return;
                    setDraft((d) => {
                      if (d.mappings.some((x) => x.sourceKey === key)) return d;
                      return {
                        ...d,
                        mappings: [
                          ...d.mappings,
                          {
                            id: mappingId(),
                            sourceKey: key,
                            sourceLabel: key,
                            kind: "form",
                            crmField: manualCrm || "nome",
                          },
                        ],
                      };
                    });
                    setManualSource("");
                  }}
                >
                  + Adicionar
                </Button>
              </div>
            </div>
            {draft.mappings.length > 0 ? (
              <div className="rounded-xl border border-primary/30 bg-primary/[0.08] p-4 text-sm">
                <p className="text-xs font-semibold text-primary">
                  Resumo dos mapeamentos ({draft.mappings.length} {draft.mappings.length === 1 ? "campo" : "campos"})
                </p>
                <div className="mt-3 max-h-44 space-y-1.5 overflow-y-auto overscroll-contain pr-1 text-xs leading-snug text-content-secondary">
                  {draft.mappings.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="font-medium text-content">{m.sourceLabel}</span>
                      <ArrowRight className="inline h-3 w-3 shrink-0 text-primary" aria-hidden />
                      <span>{CRM_FIELD_OPTIONS.find((o) => o.value === m.crmField)?.label ?? m.crmField}</span>
                    </div>
                  ))}
                </div>
                {draft.source && demoCatalogCoverage.expected > 0 ? (
                  <p className="mt-3 text-[11px] leading-relaxed text-content-muted">
                    Catálogo demo desta origem: {demoCatalogCoverage.matched}/{demoCatalogCoverage.expected} chaves de referência com linha de mapeamento
                    {demoCatalogCoverage.matched < demoCatalogCoverage.expected ? " — acrescente manualmente o que faltar." : "."}
                  </p>
                ) : null}
                <div className="mt-4 border-t border-primary/20 pt-3 text-xs">
                  <p className="font-semibold text-content">Estado sugerido</p>
                  <ul className="mt-2 space-y-1.5 text-content-secondary">
                    <li className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                          mappingStepHealth.ready
                            ? cn("bg-emerald-500/20", isLight ? "text-emerald-700" : "text-emerald-300")
                            : cn("bg-amber-500/15", isLight ? "text-amber-800" : "text-amber-200"),
                        )}
                        aria-hidden
                      >
                        {mappingStepHealth.ready ? "✓" : "!"}
                      </span>
                      <span className={mappingStepHealth.ready ? (isLight ? "text-emerald-800" : "text-emerald-200/90") : "text-content"}>
                        {mappingStepHealth.ready ? "Pronto para continuar" : "Revise nome e contacto (telefone ou email) no CRM Kanban"}
                      </span>
                    </li>
                    <li className="flex flex-wrap items-center gap-2">
                      <Check
                        className={cn("h-4 w-4 shrink-0", mappingStepHealth.hasNome ? (isLight ? "text-emerald-600" : "text-emerald-400") : "text-content-faint")}
                        strokeWidth={2.5}
                        aria-hidden
                      />
                      <span className={mappingStepHealth.hasNome ? (isLight ? "text-emerald-800" : "text-emerald-200/90") : ""}>Nome mapeado para o CRM</span>
                    </li>
                    <li className="flex flex-wrap items-center gap-2">
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          mappingStepHealth.hasCelular ? (isLight ? "text-emerald-600" : "text-emerald-400") : "text-content-faint",
                        )}
                        strokeWidth={2.5}
                        aria-hidden
                      />
                      <span className={mappingStepHealth.hasCelular ? (isLight ? "text-emerald-800" : "text-emerald-200/90") : ""}>Celular mapeado</span>
                    </li>
                    <li className="flex flex-wrap items-center gap-2">
                      <Check
                        className={cn("h-4 w-4 shrink-0", mappingStepHealth.hasEmail ? (isLight ? "text-emerald-600" : "text-emerald-400") : "text-content-faint")}
                        strokeWidth={2.5}
                        aria-hidden
                      />
                      <span className={mappingStepHealth.hasEmail ? (isLight ? "text-emerald-800" : "text-emerald-200/90") : ""}>Email mapeado</span>
                    </li>
                  </ul>
                </div>
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
                <label className="text-xs font-semibold text-content-muted" id={`${formId}-dist-label`}>
                  Tipo de distribuição <span className="text-primary">*</span>
                </label>
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
                            {(["equipa", "ia"] as const).map((group) => {
                              const items = filteredDistChoices.filter((c) => c.group === group);
                              if (!items.length) return null;
                              return (
                                <li key={group} className="list-none">
                                  <p className={cn(typography.ui.overline, "px-3 pb-1 pt-2 text-content-faint")}>
                                    {group === "equipa" ? "Equipa humana" : "Agentes de IA"}
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
                <ul className="mt-3 space-y-2">
                  {agents.map((a) => {
                    const checked = draft.agentIds[0] === a.id;
                    return (
                      <li key={a.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line/80 bg-surface-card px-3 py-2">
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
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface-card", isLight ? "bg-sky-500" : "bg-sky-400")} aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Nome da regra</p>
                    <p className="mt-1 break-words text-sm font-semibold text-primary">{draft.name.trim() || "—"}</p>
                  </div>
                </div>

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500 ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Canal de entrada</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {draft.source === "meta_form" ? (
                        <span className={cn("inline-flex items-center rounded-full border border-sky-400/35 bg-sky-500/10 px-2.5 py-0.5 text-xs font-semibold", isLight ? "text-sky-800" : "text-sky-200")}>
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
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface-card", isLight ? "bg-indigo-500" : "bg-indigo-400")} aria-hidden />
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
                              {draft.excludedFormIds.map(demoMetaFormLabel).join(" · ")}
                            </span>
                          ) : (
                            <span className="font-medium text-content">Todos os formulários desta página</span>
                          )
                        ) : draft.includedFormIds.length ? (
                          <span>
                            <span className="font-medium text-content">Só estes formulários:</span>{" "}
                            {draft.includedFormIds.map(demoMetaFormLabel).join(" · ")}
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
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-400 ring-2 ring-surface-card" aria-hidden />
                    <div className="mt-1 min-h-[1.25rem] w-px flex-1 bg-line/55" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-8">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-muted">Mapeamento de campos</p>
                    {draft.mappings.length ? (
                      <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto overscroll-contain rounded-lg border border-line/70 bg-surface-card/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
                        {draft.mappings.map((m) => (
                          <div key={m.id} className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                            <span className="font-medium text-violet-300" title={m.sourceLabel}>
                              {m.sourceKey}
                            </span>
                            <ArrowRight className="inline h-3 w-3 shrink-0 text-content-faint" aria-hidden />
                            <span className="font-medium text-sky-300">
                              {CRM_FIELD_OPTIONS.find((c) => c.value === m.crmField)?.label ?? m.crmField}
                            </span>
                            <span className="w-full pl-0 text-[10px] font-normal text-content-faint sm:inline sm:w-auto sm:pl-1">
                              ({m.kind === "context" ? "contexto" : "formulário"})
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-content-muted">Sem mapeamentos — opcional na demo; volte ao passo «Mapeamento» se quiser definir.</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-3.5">
                  <div className="flex w-5 shrink-0 flex-col items-center pt-1">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-500 ring-2 ring-surface-card" aria-hidden />
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
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-fuchsia-400 ring-2 ring-surface-card" aria-hidden />
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
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-purple-400 ring-2 ring-surface-card" aria-hidden />
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
                                className="inline-flex max-w-full items-center truncate rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-200"
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
