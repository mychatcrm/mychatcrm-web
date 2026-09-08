import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import type { AccessScope, ScopableLead } from "@/lib/server/access-scope";
import { SCOPABLE_LEAD_COLUMNS, leadInScope } from "@/lib/server/access-scope";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { getMeetingForSession } from "@/lib/server/meetings-db";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Sugestões da IA para o CRM.
 *
 * Princípio inegociável: a IA propõe, o humano decide. Nada aqui escreve no
 * lead — esta camada só monta o diff. A escrita acontece em `applyCrmSuggestions`,
 * e só para os campos que a pessoa marcou.
 */
export type CrmSuggestionKind = "fill" | "replace";

export type CrmSuggestion = {
  field: string;
  label: string;
  currentValue: string | null;
  suggestedValue: string;
  atMs: number | null;
  kind: CrmSuggestionKind;
  /**
   * Sugestão que SUBSTITUI um valor existente vem desmarcada por padrão:
   * sobrescrever o que alguém digitou é mais grave que deixar de preencher.
   */
  defaultChecked: boolean;
};

/** Campos que vivem em `leads.profile_metadata` (jsonb) — sem migration. */
const METADATA_FIELDS: Array<{ key: string; label: string; from: string }> = [
  { key: "orcamento", label: "Orçamento", from: "orcamentoMencionado" },
  { key: "urgencia", label: "Urgência", from: "urgencia" },
  { key: "decisor", label: "Decisor", from: "decisor" },
  { key: "proximo_contato", label: "Próximo contato", from: "proximoContato" },
];

const LIST_FIELDS: Array<{ key: string; label: string; from: string }> = [
  { key: "necessidades", label: "Necessidades", from: "necessidades" },
  { key: "dores", label: "Dores", from: "dores" },
  { key: "objecoes", label: "Objeções", from: "objecoes" },
  { key: "concorrentes", label: "Concorrentes citados", from: "concorrentesMencionados" },
];

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Lista de textos, ou de objetos com `texto`/`text` — o formato varia por template. */
function asTextList(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      const row = (entry ?? {}) as Record<string, unknown>;
      return String(row.texto ?? row.text ?? "").trim();
    })
    .filter(Boolean)
    .slice(0, 12);
  return items.length ? items.join("; ").slice(0, 500) : null;
}

const TEMPERATURE_BY_INTENT: Record<string, string> = {
  alta: "quente",
  media: "morno",
  baixa: "frio",
};

export function buildCrmSuggestions(params: {
  templateFields: Record<string, unknown>;
  summaryShort: string;
  lead: { notes?: string | null; lead_temperature?: string | null; profile_metadata?: unknown };
}): CrmSuggestion[] {
  const fields = params.templateFields ?? {};
  const metadata = metadataObject(params.lead.profile_metadata);
  const suggestions: CrmSuggestion[] = [];

  const push = (key: string, label: string, suggested: string | null) => {
    if (!suggested) return;
    const current = asText(metadata[key]);
    if (current === suggested) return;
    const kind: CrmSuggestionKind = current ? "replace" : "fill";
    suggestions.push({
      field: `metadata.${key}`,
      label,
      currentValue: current,
      suggestedValue: suggested,
      atMs: null,
      kind,
      defaultChecked: kind === "fill",
    });
  };

  for (const field of METADATA_FIELDS) push(field.key, field.label, asText(fields[field.from]));
  for (const field of LIST_FIELDS) push(field.key, field.label, asTextList(fields[field.from]));

  // Temperatura derivada da intenção de compra declarada na conversa.
  const intent = typeof fields.intencaoCompra === "string" ? fields.intencaoCompra : "";
  const temperature = TEMPERATURE_BY_INTENT[intent];
  if (temperature && temperature !== params.lead.lead_temperature) {
    suggestions.push({
      field: "lead_temperature",
      label: "Temperatura",
      currentValue: params.lead.lead_temperature ?? null,
      suggestedValue: temperature,
      atMs: null,
      kind: params.lead.lead_temperature ? "replace" : "fill",
      defaultChecked: !params.lead.lead_temperature,
    });
  }

  return suggestions;
}

export async function getCrmSuggestions(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
}): Promise<{ leadId: string; leadName: string; suggestions: CrmSuggestion[] } | null> {
  const meeting = await getMeetingForSession(params);
  if (!meeting?.leadId) return null;

  const [{ data: leadRow }, { data: analyses }] = await Promise.all([
    params.sb
      .from("leads")
      .select(`id, name, notes, lead_temperature, profile_metadata, ${SCOPABLE_LEAD_COLUMNS}`)
      .eq("tenant_id", meeting.tenantId)
      .eq("id", meeting.leadId)
      .maybeSingle(),
    params.sb
      .from("meeting_analyses")
      .select("summary_short, payload, template_key")
      .eq("tenant_id", meeting.tenantId)
      .eq("meeting_id", meeting.id)
      .eq("processing_version", meeting.processingVersion),
  ]);

  if (!leadRow) return null;
  // O lead precisa estar no escopo de quem pergunta, mesmo que a reunião esteja.
  if (!leadInScope(leadRow as unknown as ScopableLead, params.scope)) return null;

  const analysisRow = ((analyses ?? []) as unknown as Array<Record<string, unknown>>).find(
    (row) => row.template_key !== "chapters",
  );
  if (!analysisRow) return null;

  const payload = metadataObject(analysisRow.payload);
  const lead = leadRow as unknown as Record<string, unknown>;

  return {
    leadId: String(lead.id),
    leadName: String(lead.name ?? "Lead"),
    suggestions: buildCrmSuggestions({
      templateFields: metadataObject(payload.templateFields),
      summaryShort: String(analysisRow.summary_short ?? ""),
      lead: {
        notes: typeof lead.notes === "string" ? lead.notes : null,
        lead_temperature: typeof lead.lead_temperature === "string" ? lead.lead_temperature : null,
        profile_metadata: lead.profile_metadata,
      },
    }),
  };
}

/**
 * Aplica APENAS os campos que a pessoa marcou.
 *
 * Nenhum caminho aqui aceita valor vindo do cliente: o servidor recalcula as
 * sugestões e usa só as que ele mesmo produziu. Sem isso, a rota viraria uma
 * forma de escrever qualquer coisa no lead com a aparência de "a IA sugeriu".
 */
export async function applyCrmSuggestions(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
  fields: string[];
}): Promise<{ applied: string[] } | null> {
  const computed = await getCrmSuggestions(params);
  if (!computed) return null;

  const wanted = new Set(params.fields);
  const selected = computed.suggestions.filter((suggestion) => wanted.has(suggestion.field));
  if (selected.length === 0) return { applied: [] };

  const { data: leadRow } = await params.sb
    .from("leads")
    .select("profile_metadata")
    .eq("tenant_id", params.session.tenantId)
    .eq("id", computed.leadId)
    .maybeSingle();

  const metadata = metadataObject((leadRow as { profile_metadata?: unknown } | null)?.profile_metadata);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const suggestion of selected) {
    if (suggestion.field.startsWith("metadata.")) {
      metadata[suggestion.field.slice("metadata.".length)] = suggestion.suggestedValue;
    } else if (suggestion.field === "lead_temperature") {
      patch.lead_temperature = suggestion.suggestedValue;
    }
  }
  patch.profile_metadata = metadata;

  const { error } = await params.sb
    .from("leads")
    .update(patch)
    .eq("tenant_id", params.session.tenantId)
    .eq("id", computed.leadId);

  if (error) throw new Error("crm_suggestion_apply_failed");

  await appendOperationalAuditEvent({
    tenantId: params.session.tenantId,
    actorType: "customer",
    actorId: params.session.employeeId ?? params.session.email,
    module: "meetings",
    action: "crm_suggestion_applied",
    resourceType: "lead",
    resourceId: computed.leadId,
    status: "completed",
    relatedIds: { meeting_id: params.meetingId },
    // Só os NOMES dos campos: valores de lead são PII e não entram na auditoria.
    metadata: { fields: selected.map((suggestion) => suggestion.field).join(","), count: selected.length },
  });

  return { applied: selected.map((suggestion) => suggestion.field) };
}
