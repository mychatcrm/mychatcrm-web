import { NextResponse } from "next/server";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import {
  createAgentKnowledgeUpload,
  listAgentKnowledgeFiles,
} from "@/lib/server/agent-knowledge-files";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { assertManageableTenantAgent } from "@/lib/server/agent-management-record";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;
  const agentId = params.id?.trim();
  if (!agentId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
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
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;
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
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
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
