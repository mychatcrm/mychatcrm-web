import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { loadIntegrationsDashboardSnapshot } from "@/lib/server/integrations-dashboard-snapshot";

export const dynamic = "force-dynamic";
export const preferredRegion = "gru1";

export type MetaStatusForm = {
  form_id: string;
  form_name: string | null;
  agent_id: string | null;
  has_active_rule: boolean;
};

export type MetaStatusPage = {
  page_id: string;
  page_name: string | null;
  connected_at: string;
  health_status:
    | "provisioning"
    | "ready"
    | "retrying"
    | "action_required"
    | "revoked"
    | "unverified"
    | "legacy_grace"
    | "degraded";
  health_code: string | null;
  health_message: string | null;
  lead_access_status:
    | "unverified"
    | "pending_first_lead"
    | "verified_by_retrieval"
    | "verified_by_delivery"
    | "action_required";
  last_lead_access_verified_at: string | null;
  last_verified_at: string | null;
  last_webhook_at: string | null;
  subscribed_fields: string[];
  forms_error: string | null;
  all_forms_have_active_rule?: boolean;
  forms: MetaStatusForm[];
};

export type MetaStatusResponse = {
  connected: boolean;
  action_required: boolean;
  verification_pending: boolean;
  grant_discovery_status:
    | "pending"
    | "discovering"
    | "ready"
    | "retrying"
    | "action_required"
    | null;
  grant_error_code: string | null;
  pages: MetaStatusPage[];
};

/**
 * Estado canônico salvo no banco. A abertura da página nunca consulta o Graph.
 * A lista completa de formulários continua em /api/client/meta/forms e só é
 * carregada quando o usuário abre os detalhes de uma Página.
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = performance.now();
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  try {
    const snapshot = await loadIntegrationsDashboardSnapshot(guard.session);
    const durationMs = Math.round(performance.now() - startedAt);
    return NextResponse.json(snapshot.meta, {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `meta-db;dur=${durationMs}`,
      },
    });
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    console.error("[meta/status] database_snapshot_failed", {
      tenant_id: guard.session.tenantId,
      duration_ms: durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Não foi possível consultar o estado Meta agora." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Server-Timing": `meta-db;dur=${durationMs}` } },
    );
  }
}
