import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { deleteR2Object } from "@/lib/integrations/r2-storage";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const BATCH = 50;

/**
 * Varredura de retenção.
 *
 * Duas tarefas distintas:
 *  1. Áudio vencido pelo prazo do plano — o objeto sai do R2, mas transcrição e
 *     análise ficam. Texto ocupa ~30 KB por reunião; gravação é o dado mais
 *     sensível que o produto guarda, e apagá-la no prazo é decisão de
 *     privacidade antes de ser de custo.
 *  2. Reunião excluída pelo usuário — apaga tudo, incluindo o objeto.
 *
 * A ordem importa: apagar a LINHA primeiro deixaria o áudio órfão no bucket,
 * sem ponteiro, e ninguém saberia que ele existe para remover depois.
 */
export async function sweepMeetingRetention(
  sb: SupabaseServiceClient = createSupabaseServiceClient(),
): Promise<{ audioExpired: number; hardDeleted: number; failures: number }> {
  const result = { audioExpired: 0, hardDeleted: 0, failures: 0 };
  const now = new Date().toISOString();

  // (1) Áudio vencido — o registro permanece.
  const { data: expired } = await sb
    .from("meetings")
    .select("id, tenant_id, storage_key")
    .is("audio_deleted_at", null)
    .is("deleted_at", null)
    .not("retention_until", "is", null)
    .lt("retention_until", now)
    .limit(BATCH);

  for (const row of (expired ?? []) as Array<{
    id: string;
    tenant_id: string;
    storage_key: string;
  }>) {
    try {
      await deleteR2Object(row.storage_key);
      await sb
        .from("meetings")
        .update({ audio_deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("tenant_id", row.tenant_id)
        .eq("id", row.id);
      result.audioExpired += 1;

      await appendOperationalAuditEvent({
        tenantId: row.tenant_id,
        actorType: "cron",
        module: "meetings",
        action: "audio_retention_expired",
        resourceType: "meeting",
        resourceId: row.id,
        status: "completed",
      });
    } catch {
      // Falha no storage não pode marcar como apagado: marcaria um áudio que
      // continua lá, e ele nunca mais entraria na varredura.
      result.failures += 1;
    }
  }

  // (2) Exclusão definitiva pedida pelo usuário. O cascade das FKs remove
  // segmentos, falantes, análises, tarefas e decisões junto.
  const { data: deleted } = await sb
    .from("meetings")
    .select("id, tenant_id, storage_key, audio_deleted_at")
    .not("deleted_at", "is", null)
    .limit(BATCH);

  for (const row of (deleted ?? []) as Array<{
    id: string;
    tenant_id: string;
    storage_key: string;
    audio_deleted_at: string | null;
  }>) {
    try {
      if (!row.audio_deleted_at) await deleteR2Object(row.storage_key);
      await sb.from("meetings").delete().eq("tenant_id", row.tenant_id).eq("id", row.id);
      result.hardDeleted += 1;

      await appendOperationalAuditEvent({
        tenantId: row.tenant_id,
        actorType: "cron",
        module: "meetings",
        action: "meeting_hard_deleted",
        resourceType: "meeting",
        resourceId: row.id,
        status: "completed",
      });
    } catch {
      result.failures += 1;
    }
  }

  return result;
}
