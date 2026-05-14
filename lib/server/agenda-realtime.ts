import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { agendaRealtimeChannel } from "@/lib/agenda/realtime";

/** Notifica clientes inscritos no canal broadcast do tenant. */
export async function broadcastAgendaChange(tenantId: string, action: "insert" | "update" | "delete") {
  try {
    const sb = createSupabaseServiceClient();
    await new Promise<void>((resolve, reject) => {
      const channel = sb.channel(agendaRealtimeChannel(tenantId));
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel
            .send({
              type: "broadcast",
              event: "agenda_change",
              payload: { action, at: new Date().toISOString() },
            })
            .then(() => {
              void sb.removeChannel(channel);
              resolve();
            })
            .catch(reject);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          void sb.removeChannel(channel);
          reject(new Error(`realtime channel ${status}`));
        }
      });
    });
  } catch (err) {
    console.warn("[agenda-realtime] broadcast failed", err);
  }
}
