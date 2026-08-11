import { Suspense } from "react";
import { redirect } from "next/navigation";
import { IntegracoesHub } from "@/components/dashboard/integrations/IntegracoesHub";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { loadIntegrationsDashboardSnapshot } from "@/lib/server/integrations-dashboard-snapshot";

export const dynamic = "force-dynamic";
export const preferredRegion = "gru1";

export default async function IntegracoesPage() {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard/integracoes");
  const snapshot = await loadIntegrationsDashboardSnapshot(session);

  return (
    <Suspense fallback={null}>
      <IntegracoesHub tenantId={session.tenantId} initialSnapshot={snapshot} />
    </Suspense>
  );
}
