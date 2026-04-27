import { redirect } from "next/navigation";
import { AgentConversationsSection } from "@/components/dashboard/agentes/AgentsHub";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";

export default async function DashboardAgenteConversasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard/agentes");

  const { id } = await params;

  return <AgentConversationsSection session={session} agentId={id} />;
}
