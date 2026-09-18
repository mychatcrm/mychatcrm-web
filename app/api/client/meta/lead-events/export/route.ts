/**
 * GET /api/client/meta/lead-events/export
 *
 * Exporta o recorte inteiro da Central em CSV, em streaming e paginado por
 * keyset. Não existe "carregar tudo em memória": um tenant do plano Escala
 * chega a 15.000 leads/mês e o export precisa sair sem derrubar a função.
 *
 * Separador `;` e BOM UTF-8 porque o destino real é o Excel em português —
 * com `,` e sem BOM ele junta tudo numa coluna e quebra os acentos.
 */
import { NextRequest } from "next/server";
import { requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { iterateMetaLeadEvents, type CentralLeadRow } from "@/lib/server/meta-lead-central";
import { parseCentralFilters, zonedDayOf } from "@/lib/meta-leads/central-filters";
import { bucketMetaLeadEventStep } from "@/lib/meta-lead-event-status";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { resolveLeadOutcomes } from "@/lib/server/meta-lead-outcome";
import { OUTCOME_CSV_LABEL } from "@/lib/meta-leads/outcome-labels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_EXPORT_ROWS = 50_000;
/** Margem antes do teto da função: o ficheiro já começou a sair. */
const EXPORT_DEADLINE_MS = 50_000;

const COLUMNS = [
  "Data",
  "Hora",
  "Nome",
  "Telefone",
  "E-mail",
  "Campanha",
  "Conjunto",
  "Anúncio",
  "Formulário",
  "Página",
  "Agente",
  "Estado",
  "Resultado",
  "Etapa no funil",
  "Respondeu em (min)",
  "Agendamento",
  "Responsável",
  "Equipe",
  "CRM",
  "WhatsApp",
  "Etapa",
  "Mensagem de erro",
  "Arquivado",
  "Leadgen ID",
  "Lead CRM",
] as const;

const BUCKET_LABEL: Record<string, string> = {
  novo: "Novo",
  ok: "OK",
  sem_regra: "Sem regra",
  erro: "Erro",
};

/** Blinda contra fórmula injetada em planilha (`=`, `+`, `-`, `@` no início). */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\r?\n/g, " ").trim();
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

type ExportOutcome = {
  outcome: string;
  columnLabel: string | null;
  firstReplyMinutes: number | null;
  scheduledAt: string | null;
  ownerName: string | null;
  teamName: string | null;
};

function rowToCsv(
  row: CentralLeadRow,
  timezone: string,
  agentNames: Map<string, string>,
  outcome: ExportOutcome | null,
): string {
  const created = new Date(row.created_at);
  const day = Number.isNaN(created.getTime()) ? "" : zonedDayOf(created, timezone);
  const time = Number.isNaN(created.getTime())
    ? ""
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(created);

  return [
    day,
    time,
    row.name,
    row.phone,
    row.email,
    row.campaign_name ?? row.campaign_id,
    row.adset_name ?? row.adset_id,
    row.ad_name ?? row.ad_id,
    row.form_name ?? row.form_id,
    row.page_name ?? row.page_id,
    row.agent_id ? (agentNames.get(row.agent_id) ?? row.agent_id) : "",
    BUCKET_LABEL[bucketMetaLeadEventStep(row.current_step)] ?? row.current_step,
    outcome ? (OUTCOME_CSV_LABEL[outcome.outcome] ?? outcome.outcome) : "",
    outcome?.columnLabel ?? "",
    outcome?.firstReplyMinutes ?? "",
    outcome?.scheduledAt
      ? new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(
          new Date(outcome.scheduledAt),
        )
      : "",
    outcome?.ownerName ?? "",
    outcome?.teamName ?? "",
    row.crm_sync_status,
    row.whatsapp_status,
    row.current_step,
    row.error_message,
    row.archived_at ? "sim" : "não",
    row.leadgen_id,
    row.lead_id,
  ]
    .map(csvCell)
    .join(";");
}

export async function GET(req: NextRequest): Promise<Response> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const filters = parseCentralFilters(req.nextUrl.searchParams);

  const { data: agentRows } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name")
    .eq("tenant_id", session.tenantId);
  const agentNames = new Map<string, string>();
  for (const row of (agentRows ?? []) as Array<{ agent_id?: unknown; display_name?: unknown }>) {
    if (typeof row.agent_id === "string" && typeof row.display_name === "string") {
      agentNames.set(row.agent_id, row.display_name);
    }
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let exported = 0;
  let deadlineHit = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("﻿"));
        controller.enqueue(encoder.encode(`${COLUMNS.join(";")}\r\n`));
        for await (const page of iterateMetaLeadEvents({
          sb,
          tenantId: session.tenantId,
          scope,
          filters,
          maxRows: MAX_EXPORT_ROWS,
        })) {
          const outcomes = await resolveLeadOutcomes({
            sb,
            tenantId: session.tenantId,
            leadIds: page.map((row) => row.lead_id).filter((id): id is string => Boolean(id)),
          });
          const chunk = page
            .map((row) =>
              rowToCsv(
                row,
                filters.timezone,
                agentNames,
                row.lead_id ? (outcomes.get(row.lead_id) ?? null) : null,
              ),
            )
            .join("\r\n");
          controller.enqueue(encoder.encode(`${chunk}\r\n`));
          exported += page.length;

          if (Date.now() - startedAt > EXPORT_DEADLINE_MS) {
            deadlineHit = true;
            controller.enqueue(
              encoder.encode(
                `"Exportação parcial: ${exported} linhas. Estreite o período ou os filtros para levar o resto."\r\n`,
              ),
            );
            break;
          }
        }
      } catch (error) {
        // O cabeçalho já foi enviado; encerrar com uma linha de aviso é melhor
        // do que entregar um ficheiro truncado sem explicação.
        const message = error instanceof Error ? error.message.slice(0, 120) : "erro";
        controller.enqueue(encoder.encode(`"Exportação interrompida: ${message}"\r\n`));
        console.error("[meta-lead-central] export_failed", { tenant_id: session.tenantId, message });
      } finally {
        controller.close();
        void appendOperationalAuditEvent({
          tenantId: session.tenantId,
          actorType: "customer",
          actorId: session.employeeId ?? "owner",
          module: "leads.central",
          action: "export.csv",
          resourceType: "meta_lead_events",
          status: "completed",
          severity: "info",
          integration: "meta_lead_ads",
          metadata: {
            rows: exported,
            partial: deadlineHit,
            has_period: Boolean(filters.from || filters.to),
            campaigns: filters.campaignIds.length,
            forms: filters.formIds.length,
            archived: filters.archived,
          },
        });
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-meta-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
