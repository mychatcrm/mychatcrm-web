/**
 * GET /api/admin/meetings/metrics
 *
 * Volume, custo, consumo por empresa e saúde do pipeline.
 *
 * Custo de transcrição é ESTIMADO a partir dos minutos processados: o provedor
 * não devolve valor por requisição, então a alternativa seria não mostrar custo
 * nenhum. A constante fica visível na resposta para o número poder ser
 * conferido contra a fatura real.
 */
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** US$ por hora de áudio transcrito (AssemblyAI Universal, set/2026). */
const TRANSCRIPTION_USD_PER_HOUR = 0.27;

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "reunioes")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("dias") ?? 30), 1), 180);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const sb = createSupabaseServiceClient();

  const [meetings, jobs, usage, aiCost] = await Promise.all([
    sb
      .from("meetings")
      .select("id, tenant_id, status, source, duration_ms, created_at, provider, failed_reason")
      .gte("created_at", since)
      .limit(5000),
    sb
      .from("meeting_jobs")
      .select("id, tenant_id, meeting_id, stage, status, attempts, last_error_code, updated_at")
      .in("status", ["pending", "processing", "failed", "dead_letter"])
      .order("updated_at", { ascending: false })
      .limit(200),
    sb.from("tenant_meeting_usage").select("tenant_id, cycle_month, seconds_processed, meetings_count"),
    sb
      .from("ai_usage_logs")
      .select("estimated_cost_usd, feature")
      .in("feature", ["meeting_analysis", "meeting_chat"])
      .gte("created_at", since)
      .limit(20_000),
  ]);

  const rows = (meetings.data ?? []) as unknown as Array<Record<string, unknown>>;
  const totalDurationMs = rows.reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0);
  const completed = rows.filter((row) => row.status === "completed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const partial = rows.filter((row) => row.status === "partial").length;

  const byTenant = new Map<string, { meetings: number; minutes: number }>();
  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    const entry = byTenant.get(tenantId) ?? { meetings: 0, minutes: 0 };
    entry.meetings += 1;
    entry.minutes += Number(row.duration_ms ?? 0) / 60_000;
    byTenant.set(tenantId, entry);
  }

  const errorCounts = new Map<string, number>();
  for (const row of (jobs.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const code = typeof row.last_error_code === "string" ? row.last_error_code : null;
    if (code) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
  }

  const hours = totalDurationMs / 3_600_000;
  const analysisCostUsd = ((aiCost.data ?? []) as unknown as Array<Record<string, unknown>>).reduce(
    (sum, row) => sum + Number(row.estimated_cost_usd ?? 0),
    0,
  );

  return NextResponse.json(
    {
      periodDays: days,
      volume: {
        total: rows.length,
        completed,
        partial,
        failed,
        recorded: rows.filter((row) => row.source === "record").length,
        uploaded: rows.filter((row) => row.source === "upload").length,
        hoursProcessed: Number(hours.toFixed(2)),
        averageDurationMin: rows.length ? Number((totalDurationMs / rows.length / 60_000).toFixed(1)) : 0,
        successRate: rows.length ? Number((((completed + partial) / rows.length) * 100).toFixed(1)) : null,
      },
      cost: {
        transcriptionUsd: Number((hours * TRANSCRIPTION_USD_PER_HOUR).toFixed(2)),
        analysisUsd: Number(analysisCostUsd.toFixed(2)),
        totalUsd: Number((hours * TRANSCRIPTION_USD_PER_HOUR + analysisCostUsd).toFixed(2)),
        perHourUsdAssumed: TRANSCRIPTION_USD_PER_HOUR,
        note: "Custo de transcrição é estimado por hora processada; confira contra a fatura do provedor.",
      },
      topTenants: Array.from(byTenant.entries())
        .map(([tenantId, entry]) => ({
          tenantId,
          meetings: entry.meetings,
          minutes: Number(entry.minutes.toFixed(0)),
        }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 20),
      pipeline: {
        openJobs: (jobs.data ?? []).length,
        deadLetter: ((jobs.data ?? []) as Array<{ status?: string }>).filter(
          (job) => job.status === "dead_letter",
        ).length,
        errorsByCode: Array.from(errorCounts.entries())
          .map(([code, count]) => ({ code, count }))
          .sort((a, b) => b.count - a.count),
        jobs: jobs.data ?? [],
      },
      usageCycles: usage.data ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
