import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getSlotPurposesForTenant } from "@/lib/server/whatsapp-slot-provider";

export const dynamic = "force-dynamic";

type EvolutionConnectionRow = {
  id: string;
  slot_index: number;
  instance_name: string;
  connection_state: string;
  wa_jid: string | null;
};

export async function GET() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { tenantId } = guard.session;

  const [{ data, error }, purposeBySlot] = await Promise.all([
    createSupabaseServiceClient()
      .from("tenant_evolution_instances")
      .select("id, slot_index, instance_name, connection_state, wa_jid")
      .eq("tenant_id", tenantId)
      .order("slot_index", { ascending: true })
      .returns<EvolutionConnectionRow[]>(),
    getSlotPurposesForTenant(tenantId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  // A finalidade da linha viaja junto com a conexão para o wizard só oferecer
  // linhas compatíveis com a origem da regra que está sendo criada.
  const connections = (data ?? []).map((row) => ({
    ...row,
    purpose: purposeBySlot.get(row.slot_index) ?? null,
  }));

  return NextResponse.json({ connections, purposes: Object.fromEntries(purposeBySlot) });
}
