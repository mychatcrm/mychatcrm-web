import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AgentsListSection } from "@/components/dashboard/agentes/AgentsHub";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";

export default async function DashboardAgentesPage() {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard/agentes");

  return (
    <Suspense fallback={<div className="p-6 text-sm text-content-muted">A carregar agentes…</div>}>
      <AgentsListSection session={session} />
    </Suspense>
  );
}
