import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import {
  completeAgentKnowledgeUpload,
  removeAgentKnowledgeFile,
} from "@/lib/server/agent-knowledge-files";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { processAgentKnowledgeJobs } from "@/lib/server/agent-knowledge-processing";
import { assertManageableTenantAgent } from "@/lib/server/agent-management-record";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;
  const agentId = params.id?.trim();
  const fileId = params.fileId?.trim();
  if (!agentId || !fileId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
    const file = await completeAgentKnowledgeUpload({
      sb,
      tenantId: session.tenantId,
      agentId,
      fileId,
    });
    waitUntil(
      processAgentKnowledgeJobs({ limit: 1 }).catch((error) => {
        console.warn("[agent-knowledge] immediate_processing_failed", {
          tenant_id: session.tenantId,
          agent_id: agentId,
          file_id: fileId,
          error: error instanceof Error ? error.message : "knowledge_processing_failed",
        });
      }),
    );
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
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;
  const agentId = params.id?.trim();
  const fileId = params.fileId?.trim();
  if (!agentId || !fileId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
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
