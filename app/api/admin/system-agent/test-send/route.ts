import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getSystemAgentInstanceName, sendSystemNotification } from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let body: { toNumber?: string; message?: string } = {};
  try {
    body = (await request.json()) as { toNumber?: string; message?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const toNumber = body.toNumber?.trim();
  if (!toNumber) {
    return NextResponse.json({ error: "Informe o número de destino (toNumber)." }, { status: 400 });
  }

  const instanceName = await getSystemAgentInstanceName();
  if (!instanceName) {
    return NextResponse.json({ error: "Instância do agente do sistema não configurada." }, { status: 503 });
  }

  const message =
    body.message?.trim() ||
    "Teste MyChatCRM — agente do sistema. Se você recebeu esta mensagem, o envio está funcionando.";

  const result = await sendSystemNotification(toNumber, message, instanceName, {
    type: "admin_test",
    metadata: { requested_by: session.email ?? "admin" },
    waitForOutcomeMs: 5000,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "send_failed",
        deliveryStatus: result.deliveryStatus,
        deliveryError: result.deliveryError,
        debug: result.debug,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    deliveryStatus: result.deliveryStatus,
    debug: result.debug,
  });
}
