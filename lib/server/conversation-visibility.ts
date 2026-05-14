import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { upsertConversationState } from "@/lib/server/conversation-memory";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function hideConversationsForTenant(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJids: string[];
  hiddenBy?: string | null;
  archive?: boolean;
}): Promise<number> {
  const jids = [...new Set(params.remoteJids.map((j) => j.trim()).filter(Boolean))];
  if (!jids.length) return 0;

  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  let affected = 0;

  for (const remoteJid of jids) {
    const state = await upsertConversationState({
      sb,
      tenantId: params.tenantId,
      remoteJid,
      isHidden: true,
      archivedAt: params.archive ? now : undefined,
      hiddenAt: now,
      hiddenBy: params.hiddenBy ?? "conversas_panel",
    });
    if (state) affected += 1;
  }

  return affected;
}

export async function revealConversationOnInbound(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<void> {
  await upsertConversationState({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    isHidden: false,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
  });
}

export function isConversationVisibleInInbox(state: {
  isHidden?: boolean;
  archivedAt?: string | null;
} | null | undefined): boolean {
  if (!state) return true;
  if (state.isHidden) return false;
  if (state.archivedAt) return false;
  return true;
}
