import type { ClientLead } from "@/lib/dashboard-data";

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  agent_id: string | null;
  last_seen: string | null;
  last_message_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  crm_funnel_id?: string | null;
  owner_employee_id?: string | null;
};

function toDateISO(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatRelativeContact(value: string | null | undefined): string {
  if (!value) return "Sem contato recente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem contato recente";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} d`;
}

function sourceLabel(source: string | null | undefined): string {
  const clean = source?.trim().toLowerCase() ?? "";
  if (clean === "whatsapp") return "WhatsApp";
  if (clean.includes("facebook") || clean.includes("meta") || clean.includes("form")) return "Meta / Facebook";
  return "Entrada manual";
}

export function lastContactAt(row: LeadRow): string | null {
  return row.last_message_at ?? row.last_seen ?? row.updated_at ?? row.created_at ?? null;
}

export function daysSinceContact(row: LeadRow): number | null {
  const at = lastContactAt(row);
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

export function rowToActiveOfferClientLead(row: LeadRow, ownerNamesById?: Map<string, string>): ClientLead {
  const agent = row.agent_id?.trim() || "Agente padrão · CRM";
  const origem = sourceLabel(row.source);
  const ownerEmployeeId = row.owner_employee_id?.trim() || undefined;
  const responsavel = ownerEmployeeId
    ? ownerNamesById?.get(ownerEmployeeId) ?? "Atendente"
    : "Equipe";
  const contactAt = lastContactAt(row);

  return {
    id: row.id,
    funilId: row.crm_funnel_id?.trim() || "funil-default",
    dataEntradaISO: toDateISO(row.created_at),
    nome: row.name?.trim() || row.phone?.trim() || "Lead sem nome",
    empresa: "—",
    telefone: row.phone?.trim() || "—",
    email: row.email?.trim() || "—",
    valor: 0,
    status: row.status?.trim() || "novo",
    tag: origem === "WhatsApp" ? "WhatsApp" : "Novo",
    agenteEntrada: agent,
    agenteAtendendo: agent,
    responsavel,
    ownerEmployeeId,
    ultimoContato: formatRelativeContact(contactAt),
    proximaAcao: row.notes?.trim() || "Qualificar interesse",
    origem,
    tags: origem === "WhatsApp" ? ["WhatsApp", "Novo"] : ["Novo"],
  };
}

export const ACTIVE_OFFER_LEAD_SELECT =
  "id, name, phone, email, source, status, notes, agent_id, last_seen, last_message_at, created_at, updated_at, crm_funnel_id, owner_employee_id";

export type ActiveOfferLeadWithProgress = ClientLead & {
  progress: {
    disposition: string;
    attemptCount: number;
    lastAttemptAt: string | null;
    assignedEmployeeId: string | null;
    notes: string | null;
    daysSinceContact: number | null;
  };
};

export function attachProgressToLead(
  lead: ClientLead,
  progress: {
    disposition: string;
    attemptCount: number;
    lastAttemptAt: string | null;
    assignedEmployeeId: string | null;
    notes: string | null;
    daysSinceContact: number | null;
  },
): ActiveOfferLeadWithProgress {
  return { ...lead, progress };
}
