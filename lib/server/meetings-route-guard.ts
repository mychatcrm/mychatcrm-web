import "server-only";

import { NextResponse } from "next/server";
import type { ClientSession } from "@/lib/client-auth";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveAccessScope, type AccessScope } from "@/lib/server/access-scope";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { MeetingQuotaExceededError } from "@/lib/server/meeting-quota";
import { MEETINGS_MODULE_UNAVAILABLE } from "@/lib/meetings/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Liberacao do modulo.
 *
 * `MEETINGS_ENABLED=0` deixa o backend inteiro no ar respondendo 404 — e o que
 * permite subir o codigo sem efeito visivel e ligar depois. A lista por tenant
 * existe para o piloto interno: ligar so para uma conta antes de qualquer
 * cliente ver.
 */
export function isMeetingsEnabledForTenant(tenantId: string): boolean {
  const allowlist = (process.env.MEETINGS_ENABLED_TENANTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (allowlist.length > 0) return allowlist.includes(tenantId);
  return process.env.MEETINGS_ENABLED === "1";
}

export type MeetingRouteContext = {
  session: ClientSession;
  scope: AccessScope;
  sb: SupabaseServiceClient;
};

/**
 * Guard unico das rotas de reuniao: flag, sessao ativa e escopo de acesso.
 *
 * Repetir isso em cada handler seria repetir a chance de esquecer o escopo em
 * um deles — que e como vazamento entre empresas costuma acontecer.
 */
export async function requireMeetingRouteContext(): Promise<
  { ok: true; value: MeetingRouteContext } | { ok: false; response: NextResponse }
> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return { ok: false, response: guard.response };

  const { session } = guard;
  if (!isMeetingsEnabledForTenant(session.tenantId)) {
    // 404, nao 403: quando o modulo esta desligado ele nao existe para a conta.
    // O `code` viaja junto para a tela distinguir "nao liberado aqui" de
    // "reuniao inexistente" — sao a mesma resposta HTTP e explicacoes opostas.
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Recurso não encontrado.", code: MEETINGS_MODULE_UNAVAILABLE },
        { status: 404 },
      ),
    };
  }

  const sb = createSupabaseServiceClient();
  const scope = await resolveAccessScope(sb, session);
  return { ok: true, value: { session, scope, sb } };
}

/** Codigos que o cliente pode ver, com a mensagem em portugues e o status. */
const ERROR_MAP: Record<string, { status: number; message: string }> = {
  meeting_not_found: { status: 404, message: "Reunião não encontrada." },
  meeting_lead_not_found: { status: 404, message: "Lead não encontrado." },
  meeting_mime_type_not_supported: { status: 400, message: "Formato de áudio não suportado." },
  meeting_lead_visibility_requires_lead: {
    status: 400,
    message: "Para compartilhar pelo lead, vincule um lead à reunião.",
  },
  meeting_visibility_invalid: { status: 400, message: "Tipo de compartilhamento inválido." },
  meeting_type_invalid: { status: 400, message: "Tipo de reunião inválido." },
  meeting_upload_not_started: { status: 409, message: "O envio ainda não foi iniciado." },
  meeting_upload_already_finished: { status: 409, message: "Este envio já foi concluído." },
  meeting_upload_object_missing: {
    status: 422,
    message: "O áudio não chegou completo. Tente enviar novamente.",
  },
  meeting_file_too_large: { status: 413, message: "Arquivo acima do limite do seu plano." },
  meeting_duration_too_long: { status: 413, message: "Gravação acima da duração máxima do seu plano." },
  meeting_parts_invalid: { status: 400, message: "Envio inválido." },
  meeting_part_batch_invalid: { status: 400, message: "Lote de partes inválido." },
  meeting_part_number_invalid: { status: 400, message: "Parte de envio inválida." },
  meeting_part_duplicated: { status: 400, message: "Parte de envio duplicada." },
  meeting_part_etag_invalid: { status: 400, message: "Parte de envio inválida." },
  meeting_storage_key_outside_tenant: { status: 404, message: "Reunião não encontrada." },
};

/**
 * Resposta de erro sem vazar detalhe interno.
 *
 * Codigo desconhecido vira 500 generico de proposito: mensagem de erro crua do
 * banco ou do R2 conta mais sobre a infraestrutura do que o cliente precisa.
 */
export function meetingRouteError(error: unknown): NextResponse {
  if (error instanceof MeetingQuotaExceededError) {
    return NextResponse.json(
      {
        error: "Você usou todas as horas de reunião do mês.",
        code: error.code,
        quota: {
          includedSeconds: error.state.includedSeconds,
          usedSeconds: error.state.usedSeconds,
          remainingSeconds: error.state.remainingSeconds,
        },
      },
      { status: 429 },
    );
  }

  const code = error instanceof Error ? error.message : "";
  const mapped = ERROR_MAP[code];
  if (mapped) {
    return NextResponse.json({ error: mapped.message, code }, { status: mapped.status });
  }

  console.error("[meetings] erro não mapeado", code || error);
  return NextResponse.json({ error: "Não foi possível concluir a operação." }, { status: 500 });
}

/** Corpo JSON, ou `null` quando o payload nao e JSON valido. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
