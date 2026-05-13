import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import {
  completeAgentKnowledgeUpload,
  removeAgentKnowledgeFile,
} from "@/lib/server/agent-knowledge-files";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const agentId = params.id?.trim();
  const fileId = params.fileId?.trim();
  if (!agentId || !fileId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    const file = await completeAgentKnowledgeUpload({
      sb,
      tenantId: session.tenantId,
      agentId,
      fileId,
    });
    return NextResponse.json({ file });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao concluir upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const agentId = params.id?.trim();
  const fileId = params.fileId?.trim();
  if (!agentId || !fileId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    await removeAgentKnowledgeFile({
      sb,
      tenantId: session.tenantId,
      agentId,
      fileId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover material.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
