/**
 * Erros do plano de dados (PostgREST / Postgres) na área admin IA.
 * Regras: mensagens técnicas só em logs; UI/API devolvem texto seguro e accionável.
 */

export type DataPlaneSurface = {
  /** Uma linha, sem nomes de tabelas, SQL nem stack. */
  headline: string;
  /** Passos operacionais genéricos (sem schema interno). */
  guidance: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Regista o erro completo no servidor (Vercel logs, etc.). */
export function logAdminIaDataPlaneIssue(
  scope: string,
  raw: { message?: string | null; code?: string | null; details?: string | null },
  extra?: Record<string, unknown>,
): void {
  console.error(
    `[admin-ia data-plane] ${scope}`,
    JSON.stringify({
      code: raw.code ?? null,
      message: raw.message ?? null,
      details: raw.details ?? null,
      ...extra,
    }),
  );
}

/**
 * Mapeia erro PostgREST/Postgres para texto seguro ao painel admin.
 * Nunca incluir nomes de relações, políticas ou mensagens cruas do Postgres.
 */
export function surfacePostgrestForAdminUi(
  rawMessage: string | null | undefined,
  rawCode: string | null | undefined,
): DataPlaneSurface {
  const m = norm(rawMessage);
  const code = rawCode?.trim() ?? "";

  if (m.includes("[supabase/server]") || (m.includes("supabase") && m.includes("não definida"))) {
    return {
      headline: "Configuração da ligação à base de dados no servidor está incorrecta.",
      guidance:
        "No alojamento, confirme que NEXT_PUBLIC_SUPABASE_ANON_KEY é só a chave pública (JWT anon legacy ou sb_publishable_*) e SUPABASE_SERVICE_ROLE_KEY é a secret de serviço (JWT service_role ou sb_secret_*) do mesmo projecto. Não inverta nem reutilize a mesma string nas duas variáveis.",
    };
  }

  if (code === "42501" || m.includes("permission denied")) {
    return {
      headline: "Sem permissão para aceder aos dados da plataforma no servidor.",
      guidance:
        "Peça à equipa de infraestrutura para rever a configuração do ambiente de produção e as permissões na base de dados. No painel de administração, use «Diagnóstico de ligação» para um resumo seguro do estado.",
    };
  }

  if (
    m.includes("could not find the table") ||
    m.includes("schema cache") ||
    (m.includes("relation") && m.includes("does not exist")) ||
    m.includes("not exist")
  ) {
    return {
      headline: "Os dados de consumo ainda não estão disponíveis neste ambiente.",
      guidance:
        "A base de dados precisa das migrações de IA previstas no repositório. A equipa de infraestrutura deve aplicá-las no projecto correcto e voltar a publicar a aplicação.",
    };
  }

  if (m.includes("jwt") && (m.includes("invalid") || m.includes("expired"))) {
    return {
      headline: "Configuração de ligação à base de dados inválida ou expirada.",
      guidance: "Actualize as credenciais do projecto no ambiente de alojamento e publique novamente.",
    };
  }

  if (m.includes("service_role") && m.includes("role")) {
    return {
      headline: "Chave de serviço da base de dados incorrecta.",
      guidance: "A chave privilegiada do servidor não corresponde ao tipo esperado. Use o diagnóstico de ligação no painel para confirmar.",
    };
  }

  if (!m) {
    return {
      headline: "Não foi possível completar a operação na base de dados.",
      guidance: null,
    };
  }

  return {
    headline: "Não foi possível carregar ou gravar dados da plataforma neste momento.",
    guidance: "Tente mais tarde. Se o problema continuar, consulte os registos internos do servidor.",
  };
}
