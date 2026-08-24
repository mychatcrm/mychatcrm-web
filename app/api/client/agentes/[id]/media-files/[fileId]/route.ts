import { NextResponse } from "next/server";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import {
  completeAgentMediaUpload,
  removeAgentMediaFile,
  updateAgentMediaDescription,
} from "@/lib/server/agent-media-files";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AgentMediaFile } from "@/lib/server/agent-media-files";
import { assertManageableTenantAgent } from "@/lib/server/agent-management-record";

export const dynamic = "force-dynamic";

function toApiFile(file: AgentMediaFile) {
  return {
    id: file.id,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    description: file.description,
    status: file.status,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export async function POST(_request: Request, { params }: { params: { id: string; fileId: string } }) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;
  const agentId = params.id?.trim();
  const fileId = params.fileId?.trim();
  if (!agentId || !fileId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
    const file = await completeAgentMediaUpload({
      sb,
      tenantId: session.tenantId,
      agentId,
      fileId,
    });
    return NextResponse.json({ file: toApiFile(file) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao concluir upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string; fileId: string } }) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;
  const agentId = params.id?.trim();
  const fileId = params.fileId?.trim();
  if (!agentId || !fileId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const description = body.description === null || typeof body.description === "string" ? body.description : undefined;
  if (description === undefined) {
    return NextResponse.json({ error: "Campo description em falta" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  try {
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
    const file = await updateAgentMediaDescription({
      sb,
      tenantId: session.tenantId,
      agentId,
      fileId,
      description,
    });
    return NextResponse.json({ file: toApiFile(file) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar descrição.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string; fileId: string } }) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;
  const agentId = params.id?.trim();
  const fileId = params.fileId?.trim();
  if (!agentId || !fileId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
    await removeAgentMediaFile({
      sb,
      tenantId: session.tenantId,
      agentId,
      fileId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover mídia.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
