import { createClient } from "@supabase/supabase-js";

let browserClient: ReturnType<typeof createClient> | null = null;

function getSupabaseBrowser() {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}

export type WhatsappMessageRealtimeRow = {
  id: string;
  tenant_id: string;
  remote_jid: string;
  lead_id?: string | null;
  connection_id?: string | null;
  channel?: string | null;
  direction: "inbound" | "outbound";
  kind: string;
  content: string;
  media_url?: string | null;
  agent_id?: string | null;
  created_at: string;
  client_temp_id?: string | null;
  delivery_status?: string | null;
};

export function subscribeToWhatsappMessages(params: {
  tenantId: string;
  leadId?: string | null;
  remoteJid?: string | null;
  onInsert: (row: WhatsappMessageRealtimeRow) => void;
  onUpdate?: (row: WhatsappMessageRealtimeRow) => void;
  onStatus?: (status: string) => void;
  pollMs?: number;
  onPoll?: () => void;
}): () => void {
  if (typeof window === "undefined") return () => undefined;

  const supabase = getSupabaseBrowser();
  const filter = params.leadId
    ? `tenant_id=eq.${params.tenantId},lead_id=eq.${params.leadId}`
    : `tenant_id=eq.${params.tenantId}`;

  const channel = supabase
    .channel(`wamsg-${params.tenantId}-${params.leadId ?? params.remoteJid ?? "all"}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_messages",
        filter,
      },
      (payload) => {
        const row = payload.new as WhatsappMessageRealtimeRow;
        if (params.remoteJid && row.remote_jid !== params.remoteJid) return;
        params.onInsert(row);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "whatsapp_messages",
        filter,
      },
      (payload) => {
        if (!params.onUpdate) return;
        const row = payload.new as WhatsappMessageRealtimeRow;
        if (params.remoteJid && row.remote_jid !== params.remoteJid) return;
        params.onUpdate(row);
      },
    )
    .subscribe((status) => {
      params.onStatus?.(status);
    });

  const pollMs = params.pollMs ?? 0;
  const intervalId =
    pollMs > 0 && params.onPoll
      ? setInterval(() => {
          if (typeof document !== "undefined" && document.hidden) return;
          params.onPoll?.();
        }, pollMs)
      : null;

  return () => {
    if (intervalId) clearInterval(intervalId);
    params.onStatus?.("CLOSED");
    void supabase.removeChannel(channel);
  };
}
