import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import {
  createAgentKnowledgeUpload,
  listAgentKnowledgeFiles,
} from "@/lib/server/agent-knowledge-files";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function assertAgentBelongsToTenant(sb: ReturnType<typeof createSupabaseServiceClient>, tenantId: string, agentId: string) {
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (error) throw new Error("Erro ao validar agente.");
  if (!data) throw new Error("Agente não encontrado para este tenant.");
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const agentId = params.id?.trim();
  if (!agentId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    await assertAgentBelongsToTenant(sb, session.tenantId, agentId);
    const files = await listAgentKnowledgeFiles({ sb, tenantId: session.tenantId, agentId });
    return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao listar materiais.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const agentId = params.id?.trim();
  if (!agentId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  try {
    await assertAgentBelongsToTenant(sb, session.tenantId, agentId);
    const result = await createAgentKnowledgeUpload({
      sb,
      tenantId: session.tenantId,
      agentId,
      filename: String(body.filename ?? ""),
      mimeType: String(body.mimeType ?? ""),
      sizeBytes: Number(body.sizeBytes),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao iniciar upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
