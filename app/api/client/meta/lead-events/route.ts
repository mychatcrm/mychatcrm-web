/**
 * GET /api/client/meta/lead-events
 *
 * Inbox operacional: os leads mais recentes, em tempo real, para a aba
 * "Leads recebidos". Para ver a base inteira com super filtro, período e
 * export existe a Central (`/lead-events/search`).
 *
 * Duas coisas mudaram aqui e valem a leitura:
 * - O recorte de acesso passou a ser aplicado. Antes esta rota filtrava só por
 *   `tenant_id`, e como o middleware só valida papel em `/dashboard/*`, um
 *   vendedor autenticado recebia nome, telefone e e-mail de todos os leads do
 *   tenant apenas chamando a URL.
 * - `profile_metadata` saiu do select. Ela embrulha o webhook cru inteiro e era
 *   devolvida para até 1000 leads a cada 15 segundos de polling.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { scopeMatchesNothing, visibleLeadIds } from "@/lib/server/access-scope";
import type { MetaLeadEventRow } from "@/lib/server/meta-lead-events-db";
import { enrichMissingMetaLeadEventNames } from "@/lib/server/meta-lead-events-enrichment";
import { hasArchiveSupport } from "@/lib/server/meta-lead-central";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
/**
 * A inbox é a janela do "o que acabou de chegar". O teto antigo de 1000 existia
 * porque a paginação e os filtros rodavam no navegador — quem precisa de
 * histórico agora usa a Central, que pagina no banco.
 */
const MAX_LIMIT = 200;

const INBOX_COLUMNS =
  "id, tenant_id, leadgen_id, page_id, form_id, ad_id, adset_id, lead_id, name, phone, email, " +
  "form_name, page_name, campaign_id, campaign_name, adset_name, ad_name, agent_id, " +
  "agent_resolution_source, crm_sync_status, whatsapp_status, current_step, steps_log, " +
  "error_message, created_at, updated_at";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitParam)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitParam)))
    : DEFAULT_LIMIT;

  if (scopeMatchesNothing(scope)) {
    return NextResponse.json({ events: [] as MetaLeadEventRow[], tableReady: true });
  }

  const archiveSupported = await hasArchiveSupport(sb);

  // Com recorte, busca um lote maior e filtra: parte das linhas é de outra equipe.
  const allowedLeadIds = scope.kind === "all" ? null : await visibleLeadIds(sb, session.tenantId, scope);
  if (allowedLeadIds && allowedLeadIds.size === 0) {
    return NextResponse.json({ events: [] as MetaLeadEventRow[], tableReady: true });
  }

  let query = sb
    .from("meta_lead_events")
    .select(archiveSupported ? `${INBOX_COLUMNS}, archived_at` : INBOX_COLUMNS)
    .eq("tenant_id", session.tenantId);

  if (archiveSupported) query = query.is("archived_at", null);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(allowedLeadIds ? Math.min(MAX_LIMIT * 3, limit * 4) : limit);

  if (error) {
    const missing = error.code === "PGRST205" || error.code === "42P01";
    if (missing) {
      return NextResponse.json({ events: [] as MetaLeadEventRow[], tableReady: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let events = (data ?? []) as unknown as MetaLeadEventRow[];
  if (allowedLeadIds) {
    events = events
      .filter((event) => Boolean(event.lead_id) && allowedLeadIds.has(event.lead_id as string))
      .slice(0, limit);
  }

  // Lead bloqueado (ex.: "Sem regra") nunca passa pela resolução de nomes no
  // webhook — resolve sob demanda aqui e persiste, sem mexer no pipeline.
  await enrichMissingMetaLeadEventNames(sb, session.tenantId, events);

  return NextResponse.json({ events, tableReady: true });
}
