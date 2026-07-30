/**
 * Regras de distribuição de leads (demo) — encaminham entradas (formulário, WhatsApp, etc.)
 * para agentes configurados em «Agentes». Persistência local por tenant.
 */

export type LeadRuleSource = "meta_form" | "whatsapp_api" | "whatsapp_qr" | "whatsapp_organico" | "other";

/** WhatsApp de contacto direto (sem tráfego pago): no máximo uma regra e um agente por tenant (evita conflitos). */
export const ORGANIC_WHATSAPP_SOURCE: LeadRuleSource = "whatsapp_organico";

export function hasOrganicWhatsAppRule(rules: LeadDistributionRule[]): boolean {
  return rules.some((r) => r.source === ORGANIC_WHATSAPP_SOURCE);
}

export type LeadDistributionType =
  | "round_robin"
  | "specific_agents"
  | "entry_owner"
  | "all_agents"
  /** Um agente de IA recebe o lead e dispara a primeira mensagem automática. */
  | "automation_agent"
  /**
   * O agente de IA atende E o lead já nasce atribuído a um vendedor: ele vê a
   * conversa em «Conversas» desde o primeiro contacto e pode pausar o agente
   * para assumir pessoalmente. `agentIds[0]` = agente, `employeeIds[0]` = vendedor.
   */
  | "agent_plus_seller"
  /** Colaboradores humanos registados em «Colaboradores» (hierarquia com limites por papel). */
  | "specific_employees"
  | "round_robin_employees"
  | "all_employees";

export type LeadFieldMapping = {
  id: string;
  sourceKey: string;
  sourceLabel: string;
  kind: "form" | "context";
  crmField: string;
  /** Formulário Meta de origem (quando a regra cobre vários formulários). */
  formId?: string;
  formLabel?: string;
};

/**
 * Agente referenciado pela regra que não vai atender: `missing` quando o
 * agente não existe mais no tenant, `paused` quando existe mas está pausado.
 * Nos dois casos o lead entra e a automação é bloqueada silenciosamente.
 */
export type LeadRuleAgentIssue = {
  agentId: string;
  problem: "missing" | "paused";
};

export type LeadDistributionRule = {
  id: string;
  name: string;
  order: number;
  source: LeadRuleSource;
  active?: boolean;
  transport?: "evolution" | "cloud_api";
  connectionId?: string | null;
  /** Template Meta aprovado para 1º contacto Cloud (Lead Ads). */
  metaTemplateName?: string | null;
  metaTemplateLang?: string | null;
  conflictPolicy?: "latest_wins" | "priority_wins" | "keep_until_inactive" | "manual_review";
  conflictInactivityMinutes?: number;
  redistribution: boolean;
  distributionType: LeadDistributionType;
  /** Quando `specific_agents` ou `automation_agent` (este: um único id). */
  agentIds: string[];
  /** Quando `specific_employees` ou `rodízio entre colaboradores`; vazio com `all_employees` = todos os registados. */
  employeeIds: string[];
  mappings: LeadFieldMapping[];
  /**
   * Equipe dona dos leads que entram por esta regra. É o carimbo de origem:
   * o lead nasce com este `team_id` e passa a ser visível só para essa equipe.
   * `null` = sem equipe (fica visível apenas para o titular da conta).
   */
  teamId?: string | null;
  pageLabel?: string;
  pageId?: string;
  useAllForms?: boolean;
  /** Com `useAllForms`, formulários desta lista não entram na distribuição (demo). */
  excludedFormIds?: string[];
  /** Com `useAllForms` falso, só estes formulários entram na regra (demo). */
  includedFormIds?: string[];
  /** Envio de conversões (ex.: Meta Pixel / CAPI) — demo; credenciais só persistem com o envio ligado. */
  conversionSendEnabled?: boolean;
  conversionPixelId?: string;
  /** Chave de acesso à API de conversões (ex. Meta CAPI). */
  conversionApiSecret?: string;
  redistributionConfig?: {
    prazo_minutos: number;
    quantidade: number;
    tipo: LeadDistributionType;
    agent_ids: string[];
    employee_ids: string[];
    executar_anteriores: boolean;
    triggers?: {
      agent_unavailable: boolean;
      delivery_failed: boolean;
      human_timeout: boolean;
      customer_silence: boolean;
    };
    final_destination?: "next_agent" | "human_team" | "crm_only";
  };
  createdBy: string;
  createdAtLabel: string;
  /** Preenchido pela API ao listar: agentes desta regra que não vão atender. */
  agentIssues?: LeadRuleAgentIssue[];
};

const STORAGE_PREFIX = "mychatcrm.lead-rules.v1.";

function storageKey(tenantId: string) {
  return `${STORAGE_PREFIX}${tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "tenant"}`;
}

function defaultRules(): LeadDistributionRule[] {
  return [
    {
      id: "rule-demo-1",
      name: "Captação · Meta e site",
      order: 0,
      source: "meta_form",
      redistribution: false,
      distributionType: "entry_owner",
      agentIds: [],
      employeeIds: [],
      mappings: [],
      pageLabel: "Página principal",
      useAllForms: true,
      createdBy: "Conta demo",
      createdAtLabel: "26/03/2026",
    },
    {
      id: "rule-demo-2",
      name: "WhatsApp · fila comercial",
      order: 1,
      source: "whatsapp_api",
      redistribution: false,
      distributionType: "round_robin",
      agentIds: [],
      employeeIds: [],
      mappings: [],
      createdBy: "Conta demo",
      createdAtLabel: "25/03/2026",
    },
  ];
}

export function loadLeadDistributionRules(tenantId: string): LeadDistributionRule[] {
  if (typeof window === "undefined") return defaultRules();
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId));
    if (!raw) {
      const initial = defaultRules();
      window.localStorage.setItem(storageKey(tenantId), JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultRules();
    return parsed.map((rule: unknown) => {
      if (!rule || typeof rule !== "object") return rule as LeadDistributionRule;
      const { conditions: _removed, ...rest } = rule as Record<string, unknown> & { conditions?: unknown };
      return normalizeLeadDistributionRule(rest as LeadDistributionRule);
    });
  } catch {
    return defaultRules();
  }
}

export function persistLeadDistributionRules(tenantId: string, rules: LeadDistributionRule[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(rules));
    window.dispatchEvent(new Event("mychatcrm-lead-rules-updated"));
  } catch {
    /* ignore */
  }
}

export const LEAD_RULES_UPDATED_EVENT = "mychatcrm-lead-rules-updated";

function normalizeLeadDistributionRule(r: LeadDistributionRule & Record<string, unknown>): LeadDistributionRule {
  const fromNew = typeof r.conversionApiSecret === "string" ? r.conversionApiSecret.trim() : "";
  const fromLegacy =
    typeof (r as { conversionAccessToken?: unknown }).conversionAccessToken === "string"
      ? ((r as { conversionAccessToken?: string }).conversionAccessToken ?? "").trim()
      : "";
  const legacySecret = fromNew || fromLegacy;
  const { conversionAccessToken: _legacyDrop, ...rest } = r as LeadDistributionRule & {
    conversionAccessToken?: string;
  };
  const allowed: LeadDistributionType[] = [
    "round_robin",
    "specific_agents",
    "entry_owner",
    "all_agents",
    "automation_agent",
    "agent_plus_seller",
    "specific_employees",
    "round_robin_employees",
    "all_employees",
  ];
  const distributionType = allowed.includes(r.distributionType) ? r.distributionType : "round_robin";
  return {
    ...rest,
    distributionType,
    agentIds: Array.isArray(rest.agentIds) ? rest.agentIds : [],
    employeeIds: Array.isArray(rest.employeeIds) ? rest.employeeIds : [],
    conversionApiSecret: legacySecret || undefined,
  };
}

export function sourceLabel(source: LeadRuleSource): string {
  switch (source) {
    case "meta_form":
      return "Meta / formulários";
    case "whatsapp_api":
      return "WhatsApp API";
    case "whatsapp_qr":
      return "WhatsApp QR";
    case "whatsapp_organico":
      return "WhatsApp direto (sem anúncios)";
    default:
      return "Outras integrações";
  }
}

export function distributionLabel(type: LeadDistributionType): string {
  switch (type) {
    case "round_robin":
      return "Rodízio entre agentes de IA";
    case "specific_agents":
      return "Agentes de IA selecionados";
    case "entry_owner":
      return "Responsável pela entrada";
    case "all_agents":
      return "Todos os agentes de IA";
    case "automation_agent":
      return "Agente de automação (mensagem automática)";
    case "agent_plus_seller":
      return "Atendimento com agente de IA + Vendedor";
    case "specific_employees":
      return "Colaboradores selecionados";
    case "round_robin_employees":
      return "Rodízio entre colaboradores (plantão)";
    case "all_employees":
      return "Todos os colaboradores";
    default:
      return type;
  }
}
