/**
 * Rota explícita de `/dashboard/paginas`.
 *
 * Existe por causa da prévia: assim que `app/dashboard/paginas/preview/[id]`
 * passou a existir, deixar `/dashboard/paginas` a depender do catch-all
 * `[...slug]` ficou a depender da ordem de resolução do router. A rota própria
 * tira a dúvida — e é o mesmo padrão de `/dashboard/agentes`.
 *
 * A sessão e o papel são validados pelo middleware em `/dashboard/*`.
 */
import { Suspense } from "react";
import { DashboardAppEntry } from "../_components/DashboardAppEntry";

export default function DashboardPaginasPage() {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-content-muted">A carregar páginas…</div>}
    >
      <DashboardAppEntry routeKey="paginas" />
    </Suspense>
  );
}
