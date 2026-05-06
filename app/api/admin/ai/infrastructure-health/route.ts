import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { checkAdminIaRateLimit } from "@/lib/admin-ai-rate-limit";
import { classifyBackendSupabaseCredential } from "@/lib/server/supabase-admin-runtime";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type AdminIaInfrastructureHealthPayload = {
  requestId: string;
  publicUrlConfigured: boolean;
  backendKeyConfigured: boolean;
  connectivity: "healthy" | "wrong_backend_key" | "missing_backend_key" | "malformed_backend_key" | "degraded_data_plane";
  dataPlane: {
    consumptionReadable: boolean;
    limitsReadable: boolean;
    platformKeyStoreReadable: boolean;
  };
  summary: string;
};

function buildSummary(
  connectivity: AdminIaInfrastructureHealthPayload["connectivity"],
  dp: AdminIaInfrastructureHealthPayload["dataPlane"],
): string {
  switch (connectivity) {
    case "healthy":
      return "Ligação ao armazenamento interno operacional.";
    case "missing_backend_key":
      return "Falta a chave de servidor da base de dados na configuração do ambiente.";
    case "malformed_backend_key":
      return "A chave de servidor da base de dados não tem o formato esperado.";
    case "wrong_backend_key":
      return "A chave de servidor da base de dados não é a chave privilegiada correcta (muitas vezes foi colada a chave pública por engano).";
    case "degraded_data_plane":
      if (!dp.consumptionReadable && !dp.limitsReadable && !dp.platformKeyStoreReadable) {
        return "A chave privilegiada está correcta, mas o servidor ainda não consegue ler os dados internos — migrações ou permissões na base de dados em falta.";
      }
      return "A chave privilegiada está correcta, mas parte dos dados internos não está acessível — confirme migrações e permissões na base de dados.";
    default:
      return "Estado desconhecido.";
  }
}

export async function GET() {
  const requestId = randomUUID();
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const rl = checkAdminIaRateLimit(session, "infrastructure-health", 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const publicUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  const backendKeyConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const tier = classifyBackendSupabaseCredential();

  const dataPlane = {
    consumptionReadable: false,
    limitsReadable: false,
    platformKeyStoreReadable: false,
  };

  let connectivity: AdminIaInfrastructureHealthPayload["connectivity"];

  // opaque_secret e service_role: tentar cliente admin (validação completa em supabase-backend-secret.ts).
  if (tier === "missing") connectivity = "missing_backend_key";
  else if (tier === "non_jwt") connectivity = "malformed_backend_key";
  else if (tier === "non_service_role") connectivity = "wrong_backend_key";
  else {
    try {
      const sb = createSupabaseAdminClient();
      const [t1, t2, t3] = await Promise.all([
        sb.from("ai_usage_logs").select("id").limit(1),
        sb.from("ai_usage_limits").select("id").limit(1),
        sb.from("admin_platform_openai").select("id").limit(1),
      ]);
      dataPlane.consumptionReadable = !t1.error;
      dataPlane.limitsReadable = !t2.error;
      dataPlane.platformKeyStoreReadable = !t3.error;
      const allOk = dataPlane.consumptionReadable && dataPlane.limitsReadable && dataPlane.platformKeyStoreReadable;
      connectivity = allOk ? "healthy" : "degraded_data_plane";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[admin/ai/infrastructure-health] client init", JSON.stringify({ requestId, message: msg }));
      connectivity = "wrong_backend_key";
    }
  }

  const payload: AdminIaInfrastructureHealthPayload = {
    requestId,
    publicUrlConfigured,
    backendKeyConfigured,
    connectivity,
    dataPlane,
    summary: buildSummary(connectivity, dataPlane),
  };

  console.info("[admin/ai/infrastructure-health]", JSON.stringify({ requestId, connectivity, dataPlane }));

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store", "x-request-id": requestId } });
}
