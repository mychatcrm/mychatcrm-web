import { notFound, redirect } from "next/navigation";
import { AgentStandaloneEditor } from "@/components/dashboard/agentes/AgentStandaloneEditor";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { defaultDashboardPathForOrganizationRole, resolveOrganizationRole, sessionCanAccessDashboardRoute } from "@/lib/organization-role";
import { loadTenantAgentById } from "@/lib/server/tenant-agents-db";

export const dynamic = "force-dynamic";

export default async function DashboardEditarAgentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard/agentes");
  if (!sessionCanAccessDashboardRoute(session, "agentes")) {
    redirect(defaultDashboardPathForOrganizationRole(resolveOrganizationRole(session)));
  }

  const { id } = await params;
  const agent = await loadTenantAgentById(session.tenantId, id);
  if (!agent) notFound();

  return <AgentStandaloneEditor agent={agent} />;
}
