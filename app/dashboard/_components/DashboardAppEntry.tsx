import { DashboardWorkspace } from "@/components/dashboard/DashboardWorkspace";
import type { DashboardRouteKey } from "@/lib/dashboard-data";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { loadDashboardDataset } from "@/services/dashboard";

/**
 * Ponto de entrada de cada rota do dashboard (página).
 *
 * O DashboardShell (com PanelAppearanceProvider) vive no layout persistente,
 * portanto este componente só precisa carregar dados e renderizar o workspace.
 */
export async function DashboardAppEntry({ routeKey }: { routeKey: DashboardRouteKey }) {
  const session = await getClientSessionFromCookies();
  if (!session) return null; // middleware já redireciona antes de chegar aqui

  const dataset = await loadDashboardDataset(session);

  return (
    <DashboardWorkspace routeKey={routeKey} session={session} serverDataset={dataset} />
  );
}
