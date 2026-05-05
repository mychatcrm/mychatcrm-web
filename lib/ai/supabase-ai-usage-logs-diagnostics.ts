/**
 * Mapeia erros do PostgREST/Supabase ao ler `ai_usage_logs` para texto accionável no painel /admin/ia.
 */
export function buildAiUsageLogsAccessHint(rawError: string | null | undefined): string | null {
  const raw = rawError?.trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  if (t.includes("permission denied")) {
    return (
      "Provável causa: SUPABASE_SERVICE_ROLE_KEY na Vercel não é o secret service_role do mesmo projecto que " +
      "NEXT_PUBLIC_SUPABASE_URL (por exemplo colou-se a chave anon por engano). Em Supabase → Settings → API use " +
      "service_role secret, guarde em Vercel → Environment Variables → Production e faça redeploy. " +
      "Se aplicou migrações com RLS, confirme também a migração 20260508_ai_usage_rls_service_role_policies.sql."
    );
  }

  if (
    t.includes("could not find the table") ||
    t.includes("schema cache") ||
    (t.includes("relation") && t.includes("does not exist")) ||
    (t.includes("relation") && t.includes("not exist"))
  ) {
    return (
      "A tabela ainda não existe neste projecto Supabase. Aplique supabase/migrations/20260505_ai_gateway_usage_tracking.sql " +
      "(e 20260506_tenant_agents.sql, 20260507_admin_platform_openai.sql conforme necessário) no mesmo projecto da URL pública."
    );
  }

  return null;
}
