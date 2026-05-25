import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import {
  findOrphanConversations,
  repairCrmConversationConsistency,
} from "@/lib/server/crm-conversation-consistency";

export const dynamic = "force-dynamic";

/** GET — relatório de inconsistências CRM ↔ conversas */
export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const report = await findOrphanConversations({ tenantId: session.tenantId });
  return NextResponse.json({ report });
}

/** POST — reparo automático (vincular leads, corrigir status/funil, limpar órfãos) */
export async function POST() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const auditBefore = await findOrphanConversations({ tenantId: session.tenantId });
  const repair = await repairCrmConversationConsistency({ tenantId: session.tenantId });
  const auditAfter = await findOrphanConversations({ tenantId: session.tenantId });

  console.info("[crm-consistency] repair_completed", {
    tenant_id: session.tenantId,
    issues_before: auditBefore.issues.length,
    issues_after: auditAfter.issues.length,
    repair,
  });

  return NextResponse.json({
    repair,
    auditBefore,
    auditAfter,
  });
}
