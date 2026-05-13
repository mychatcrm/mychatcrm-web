import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { loadLeadChatbotHistory } from "@/lib/server/lead-chatbot-history";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const leadId = params.id?.trim();
  if (!leadId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const payload = await loadLeadChatbotHistory({
      tenantId: session.tenantId,
      leadId,
    });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "LEAD_NOT_FOUND") {
      return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
    }
    console.error("[api/client/crm/leads/chatbot-history]", code);
    return NextResponse.json({ error: "Erro ao carregar histórico do chatbot." }, { status: 503 });
  }
}
