/**
 * POST /api/admin/meetings/jobs/{jobId}/retry
 *
 * Devolve um job morto para a fila. Zera as tentativas de propósito: o operador
 * está afirmando que a causa foi resolvida (chave trocada, provedor de volta),
 * e manter o contador estourado faria o job morrer de novo na primeira falha
 * transitória.
 */
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { triggerMeetingJobProcessor } from "@/lib/server/meeting-jobs";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { jobId: string } }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "reunioes")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const jobId = params.jobId?.trim();
  if (!jobId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("meeting_jobs")
    .update({
      status: "pending",
      attempts: 0,
      available_at: new Date().toISOString(),
      claim_token: null,
      claim_expires_at: null,
      last_error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", ["failed", "dead_letter"])
    .select("id, tenant_id, meeting_id, stage")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Falha ao reenfileirar." }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "Job não encontrado ou não está em falha." },
      { status: 404 },
    );
  }

  const job = data as unknown as { tenant_id: string; meeting_id: string; stage: string };
  await appendOperationalAuditEvent({
    tenantId: job.tenant_id,
    actorType: "administrator",
    actorId: session.email,
    module: "meetings",
    action: "job_retry_manual",
    resourceType: "meeting",
    resourceId: job.meeting_id,
    status: "completed",
    metadata: { stage: job.stage },
  });

  void triggerMeetingJobProcessor();
  return NextResponse.json({ ok: true });
}
