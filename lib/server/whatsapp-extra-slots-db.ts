import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Linhas WhatsApp extra compradas pelo tenant (Stripe), usado por assertSlotIndexAllowed. */
export async function getExtraWhatsappSlots(tenantId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("stripe_subscriptions")
    .select("extra_whatsapp_slots")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data?.extra_whatsapp_slots as number) ?? 0;
}
