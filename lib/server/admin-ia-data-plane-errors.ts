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

  if (code === "42501" || m.includes("permission denied")) {
    return {
      headline: "Sem permissão para aceder aos dados da plataforma no servidor.",
      guidance:
        "Na Vercel (Production), confirme a variável de chave de serviço do Supabase (secret **service_role** do mesmo projecto que o URL público). Não use a chave pública (anon). Guarde e faça redeploy. Se já estiver correcto, aplique no Supabase as migrações de IA do repositório (ver `.env.example`).",
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
        "No Supabase do projecto ligado ao site, execute as migrações da pasta `supabase/migrations` indicadas no `.env.example` (bloco IA / gateway). Depois redeploy na Vercel.",
    };
  }

  if (m.includes("jwt") && (m.includes("invalid") || m.includes("expired"))) {
    return {
      headline: "Configuração de ligação à base de dados inválida ou expirada.",
      guidance:
        "Actualize na Vercel as variáveis do Supabase (URL e chaves) com valores actuais do dashboard do projecto e redeploy.",
    };
  }

  if (m.includes("service_role") && m.includes("role")) {
    return {
      headline: "Chave de serviço da base de dados incorrecta.",
      guidance:
        "Use na Vercel apenas o secret **service_role** do Supabase (Settings → API), nunca a chave anon.",
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
    guidance: "Tente mais tarde. Se persistir, verifique os logs do servidor e a configuração do Supabase na Vercel.",
  };
}
