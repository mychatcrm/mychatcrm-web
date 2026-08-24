import { NextResponse } from "next/server";
import { generateWizardAgentInstructions } from "@/lib/server/agent-wizard-instruction-generation";
import type { AgentWizardDraft } from "@/lib/agents/wizard-model";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulário inválido." }, { status: 400 });
  }

  const description = formData.get("description");
  if (typeof description !== "string") {
    return NextResponse.json({ error: "Descrição obrigatória." }, { status: 400 });
  }

  let draftContext: Partial<AgentWizardDraft> | undefined;
  const draftRaw = formData.get("draft");
  if (typeof draftRaw === "string" && draftRaw.trim()) {
    try {
      draftContext = JSON.parse(draftRaw) as Partial<AgentWizardDraft>;
    } catch {
      return NextResponse.json({ error: "Rascunho inválido." }, { status: 400 });
    }
  }

  const fileEntries = formData.getAll("files");
  const files: { filename: string; mimeType: string; buffer: Buffer }[] = [];

  for (const entry of fileEntries) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const buffer = Buffer.from(await entry.arrayBuffer());
    files.push({
      filename: entry.name || "arquivo",
      mimeType: entry.type || "application/octet-stream",
      buffer,
    });
  }

  const result = await generateWizardAgentInstructions({
    tenantId: session.tenantId,
    description,
    files,
    draftContext,
  });

  if (!result.ok) {
    const status = result.code === "LIMIT_EXCEEDED" ? 429 : result.code === "UNCONFIGURED" ? 503 : 400;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({
    fields: result.fields,
    fileWarnings: result.fileWarnings,
  });
}
