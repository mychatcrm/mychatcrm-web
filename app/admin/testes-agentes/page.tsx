import { notFound } from "next/navigation";
import { getAdminSessionFromCookies, isOperationalAuditOwner } from "@/lib/admin-auth";
import { AgentTestLab } from "@/components/admin/AgentTestLab";

export const dynamic = "force-dynamic";
export default async function AgentTestLabPage() {
  const session = await getAdminSessionFromCookies();
  if (!session || !isOperationalAuditOwner(session)) notFound();
  // No tenant data/QR/credentials are serialized before the scoped reauthentication.
  return <AgentTestLab enabled={process.env.AGENT_TEST_LAB_ENABLED === "true"} />;
}
