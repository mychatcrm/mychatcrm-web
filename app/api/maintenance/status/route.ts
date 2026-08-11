import { NextResponse } from "next/server";
import { readMaintenanceStatePublic } from "@/lib/server/maintenance-store-db";

// Sem isto o Next pré-renderiza a rota no build (executa o GET e congela a
// resposta), o que quebra o build sem credenciais Supabase reais e tornaria
// o estado de manutenção estático em produção.
export const dynamic = "force-dynamic";

/**
 * Estado público (sem dados internos além da mensagem configurada).
 *
 * `s-maxage` em vez de `no-store`: o middleware consulta esta rota em TODA
 * requisição de dashboard/API, e o cache dele é uma variável de módulo do
 * isolate Edge — não compartilhada entre isolates, então requisições em
 * paralelo (a tela de Integrações dispara ~11 no mount) erravam o cache e
 * invocavam esta função de novo. Medido: 526 chamadas em 2h. Deixando o CDN
 * da Vercel guardar a resposta, esse tráfego some quase todo.
 *
 * O preço é o flag demorar até ~30s pra propagar quando ligado/desligado —
 * aceitável para manutenção planejada, que é o único uso desta rota.
 */
export async function GET() {
  const s = await readMaintenanceStatePublic();
  return NextResponse.json(
    {
      enabled: s.enabled,
      message: s.message || undefined,
      estimatedReturnAt: s.estimatedReturnAt || undefined,
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } },
  );
}
