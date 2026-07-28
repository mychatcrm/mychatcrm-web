import { notFound, redirect } from "next/navigation";
import { AgentFormCompact } from "@/components/dashboard/agentes/AgentFormCompact";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { loadTenantAgentById } from "@/lib/server/tenant-agents-db";

export const dynamic = "force-dynamic";

export default async function DashboardEditarAgentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard/agentes");

  const { id } = await params;
  const agent = await loadTenantAgentById(session.tenantId, id);
  if (!agent) notFound();

  return <AgentFormCompact mode="edit" initialAgent={agent} tenantId={session.tenantId} />;
}
