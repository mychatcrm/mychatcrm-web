import { notFound, redirect } from "next/navigation";
import { AgentFormCompact } from "@/components/dashboard/agentes/AgentFormCompact";
import { getAgentByIdForTenant } from "@/lib/agents";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";

export default async function DashboardEditarAgentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard/agentes");

  const { id } = await params;
  const agent = getAgentByIdForTenant(session.tenantId, id);
  if (!agent) notFound();

  return <AgentFormCompact mode="edit" initialAgent={agent} tenantId={session.tenantId} />;
}
