import { AdminWorkspace } from "@/components/admin/AdminWorkspace";
import type { AdminRouteKey } from "@/lib/admin-data";
import { getAdminSessionFromCookies, isOperationalAuditOwner } from "@/lib/admin-auth";
import { loadAdminDataset } from "@/services/admin";
import { redirect } from "next/navigation";

/**
 * Ponto de entrada de cada rota do admin (página).
 *
 * O AdminShell (com PanelAppearanceProvider) vive no layout persistente,
 * portanto este componente só precisa carregar dados e renderizar o workspace.
 */
export async function AdminAppEntry({ routeKey }: { routeKey: AdminRouteKey }) {
  const session = await getAdminSessionFromCookies();
  if (!session) {
    // Evita renderização parcial (sem shell/sidebar) quando middleware e validação DB divergem.
    redirect("/admin/login");
  }
  if (routeKey === "logs" && !isOperationalAuditOwner(session)) {
    redirect("/admin");
  }

  const dataset = await loadAdminDataset(session);

  return (
    <AdminWorkspace routeKey={routeKey} session={session} serverDataset={dataset} />
  );
}
