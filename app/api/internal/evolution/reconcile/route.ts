import { NextResponse } from "next/server";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import { reconcileOpenEvolutionClientHealth } from "@/lib/server/evolution-client-health";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ReconcileBody = {
  afterId?: string | null;
  limit?: number;
  connectionId?: string | null;
  restartIfSettingsChanged?: boolean;
  restartSession?: boolean;
};

export async function GET(request: Request) {
  return reconcile(request, { restartIfSettingsChanged: true });
}

export async function POST(request: Request) {
  let body: ReconcileBody = {};
  try {
    body = (await request.json()) as ReconcileBody;
  } catch {
    // Corpo vazio é válido para acionamentos internos e cron.
  }
  return reconcile(request, body);
}

async function reconcile(request: Request, body: ReconcileBody) {
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "Configuração indisponível" }, { status: 503 });
  }

  const connectionId = typeof body.connectionId === "string" && body.connectionId.trim()
    ? body.connectionId.trim()
    : null;
  const isVercelCron = request.headers.get("user-agent") === "vercel-cron/1.0";
  // Em chamadas manuais, um restart exige connectionId. O cron autenticado pode
  // reparar o lote, mas a função só reinicia sessões cujo setting foi alterado,
  // gravado e lido de volta; sessões saudáveis nunca são reiniciadas.
  const restartIfSettingsChanged =
    body.restartIfSettingsChanged === true && (Boolean(connectionId) || isVercelCron);
  // Reinicio forçado é uma operação de manutenção estritamente direcionada.
  // Antes de reiniciar, o reconciliador ainda exige setting, webhook e JID válidos.
  const forceTargetedRestart = body.restartSession === true && Boolean(connectionId);
  const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(100, Number(body.limit))) : 50;
  const webhookUrl = buildEvolutionWebhookUrl(getPublicBaseUrlFromRequest(request), webhookSecret);

  try {
    const result = await reconcileOpenEvolutionClientHealth({
      webhookUrl,
      afterId: typeof body.afterId === "string" ? body.afterId : null,
      limit,
      onlyConnectionId: connectionId,
      restartIfSettingsChanged,
      forceTargetedRestart,
    });
    console.info("[evolution-client-health] reconcile_complete", {
      ...result,
      targeted: Boolean(connectionId),
      restartAuthorized: restartIfSettingsChanged,
      targetedRestartAuthorized: forceTargetedRestart,
    });
    return NextResponse.json({ ok: result.failed === 0, ...result });
  } catch (error) {
    console.error("[evolution-client-health] reconcile_failed", {
      targeted: Boolean(connectionId),
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Falha na reconciliação" }, { status: 500 });
  }
}
