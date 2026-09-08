import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import type { AccessScope } from "@/lib/server/access-scope";
import {
  abortR2MultipartUpload,
  completeR2MultipartUpload,
  createR2MultipartUpload,
  createR2PresignedPartUrl,
  getR2BucketName,
  headR2Object,
  listR2MultipartParts,
  R2_MAX_PARTS,
  R2_MIN_PART_BYTES,
  type R2CompletedPart,
} from "@/lib/integrations/r2-storage";
import { getMeetingForSession, toMeetingRecord, type MeetingRecord } from "@/lib/server/meetings-db";
import {
  assertMeetingQuotaAvailable,
  assertMeetingWithinPerFileLimits,
} from "@/lib/server/meeting-quota";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Tamanho de parte sugerido ao browser.
 *
 * O piso de 5 MB e do protocolo S3. A 32 kbps isso da ~21 minutos de audio por
 * parte — espacado demais para servir de garantia sozinho, e por isso o cliente
 * guarda cada trecho de 5 s no IndexedDB antes. A parte remota e a segunda
 * camada, nao a unica.
 */
export const MEETING_UPLOAD_PART_BYTES = R2_MIN_PART_BYTES;

/** Lote maximo de URLs por chamada — evita assinar 10.000 de uma vez. */
const MAX_PART_URLS_PER_REQUEST = 20;
const PART_URL_TTL_SECONDS = 3600;

const ETAG_RE = /^"?[A-Za-z0-9._-]{1,128}"?$/;

type UploadContext = {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
};

/**
 * Carrega a reuniao ja recortada pelo escopo e confere que ela pertence ao
 * tenant da sessao. `getMeetingForSession` devolve `null` tanto para
 * inexistente quanto para fora do escopo — o chamador responde 404 nos dois.
 */
async function loadOwnMeeting(ctx: UploadContext): Promise<MeetingRecord | null> {
  return getMeetingForSession(ctx);
}

/**
 * Segunda barreira do isolamento entre empresas.
 *
 * A chave e gravada pelo servidor e validada no banco em `reserve_meeting_v1`,
 * mas tudo que assina uma URL do R2 confere de novo: e barato, e o custo de
 * errar aqui e uma empresa ouvindo a reuniao de outra.
 */
function assertKeyBelongsToTenant(storageKey: string, tenantId: string): void {
  const prefix = `meetings/${tenantId}/`;
  if (!storageKey.startsWith(prefix)) {
    console.error("[meeting-uploads] storage key fora do tenant", {
      tenant_id: tenantId,
      key_prefix: storageKey.slice(0, 40),
    });
    throw new Error("meeting_storage_key_outside_tenant");
  }
}

export type StartMeetingUploadResult = {
  uploadId: string;
  partSizeBytes: number;
  maxParts: number;
};

export async function startMeetingUpload(ctx: UploadContext): Promise<StartMeetingUploadResult> {
  const meeting = await loadOwnMeeting(ctx);
  if (!meeting) throw new Error("meeting_not_found");
  assertKeyBelongsToTenant(meeting.storageKey, ctx.session.tenantId);

  if (meeting.status !== "draft" && meeting.status !== "uploading") {
    throw new Error("meeting_upload_already_finished");
  }

  // A cota e conferida ANTES de gravar, nunca no fim: recusar um audio que ja
  // existe nao devolve o tempo de quem gravou.
  await assertMeetingQuotaAvailable(ctx.sb, ctx.session);

  // Retomada: se ja ha um multipart aberto, continua o mesmo em vez de abrir
  // outro — abrir um segundo deixaria o primeiro orfao, ocupando espaco.
  if (meeting.uploadId) {
    return {
      uploadId: meeting.uploadId,
      partSizeBytes: MEETING_UPLOAD_PART_BYTES,
      maxParts: R2_MAX_PARTS,
    };
  }

  const uploadId = await createR2MultipartUpload({
    key: meeting.storageKey,
    contentType: meeting.mimeType,
  });

  const { error } = await ctx.sb
    .from("meetings")
    .update({
      upload_id: uploadId,
      storage_bucket: getR2BucketName(),
      status: "uploading",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.session.tenantId)
    .eq("id", ctx.meetingId);

  if (error) {
    // Sem a linha apontando para ele, o multipart seria invisivel para sempre.
    await abortR2MultipartUpload({ key: meeting.storageKey, uploadId });
    throw new Error("meeting_upload_start_failed");
  }

  return { uploadId, partSizeBytes: MEETING_UPLOAD_PART_BYTES, maxParts: R2_MAX_PARTS };
}

export async function createMeetingUploadPartUrls(
  ctx: UploadContext & { partNumbers: number[] },
): Promise<Array<{ partNumber: number; url: string }>> {
  const meeting = await loadOwnMeeting(ctx);
  if (!meeting) throw new Error("meeting_not_found");
  assertKeyBelongsToTenant(meeting.storageKey, ctx.session.tenantId);
  if (!meeting.uploadId) throw new Error("meeting_upload_not_started");

  const unique = Array.from(new Set(ctx.partNumbers));
  if (unique.length === 0 || unique.length > MAX_PART_URLS_PER_REQUEST) {
    throw new Error("meeting_part_batch_invalid");
  }
  for (const partNumber of unique) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > R2_MAX_PARTS) {
      throw new Error("meeting_part_number_invalid");
    }
  }

  const uploadId = meeting.uploadId;
  return Promise.all(
    unique
      .sort((a, b) => a - b)
      .map(async (partNumber) => ({
        partNumber,
        url: await createR2PresignedPartUrl({
          key: meeting.storageKey,
          uploadId,
          partNumber,
          expiresInSeconds: PART_URL_TTL_SECONDS,
        }),
      })),
  );
}

export type MeetingUploadStatus = {
  status: MeetingRecord["status"];
  uploadId: string | null;
  uploadedParts: R2CompletedPart[];
  /** Proximo numero de parte a enviar, para o cliente retomar sem adivinhar. */
  nextPartNumber: number;
};

/**
 * Estado do upload no R2, nao no navegador.
 *
 * E o que permite dizer "encontramos uma gravacao interrompida de 32 min":
 * mesmo com o IndexedDB perdido, o que ja subiu continua la.
 */
export async function getMeetingUploadStatus(ctx: UploadContext): Promise<MeetingUploadStatus> {
  const meeting = await loadOwnMeeting(ctx);
  if (!meeting) throw new Error("meeting_not_found");
  assertKeyBelongsToTenant(meeting.storageKey, ctx.session.tenantId);

  if (!meeting.uploadId) {
    return { status: meeting.status, uploadId: null, uploadedParts: [], nextPartNumber: 1 };
  }

  const uploadedParts = await listR2MultipartParts({
    key: meeting.storageKey,
    uploadId: meeting.uploadId,
  });
  const highest = uploadedParts.reduce((max, part) => Math.max(max, part.partNumber), 0);

  return {
    status: meeting.status,
    uploadId: meeting.uploadId,
    uploadedParts,
    nextPartNumber: highest + 1,
  };
}

function normalizeParts(parts: Array<{ partNumber: number; etag: string }>): R2CompletedPart[] {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > R2_MAX_PARTS) {
    throw new Error("meeting_parts_invalid");
  }

  const seen = new Set<number>();
  const normalized: R2CompletedPart[] = [];

  for (const part of parts) {
    const partNumber = Number(part?.partNumber);
    const etag = typeof part?.etag === "string" ? part.etag.trim() : "";
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > R2_MAX_PARTS) {
      throw new Error("meeting_part_number_invalid");
    }
    if (seen.has(partNumber)) throw new Error("meeting_part_duplicated");
    if (!ETAG_RE.test(etag)) throw new Error("meeting_part_etag_invalid");
    seen.add(partNumber);
    normalized.push({ partNumber, etag });
  }

  return normalized.sort((a, b) => a.partNumber - b.partNumber);
}

export type CompleteMeetingUploadInput = UploadContext & {
  /** Aceito por compatibilidade e ignorado: a lista que vale vem do R2. */
  parts?: Array<{ partNumber: number; etag: string }>;
  durationMs?: number | null;
  recordedAt?: string | null;
};

export async function completeMeetingUpload(
  input: CompleteMeetingUploadInput,
): Promise<MeetingRecord> {
  const meeting = await loadOwnMeeting(input);
  if (!meeting) throw new Error("meeting_not_found");
  assertKeyBelongsToTenant(meeting.storageKey, input.session.tenantId);

  // Duplo clique em "Finalizar", ou retry do cliente depois de um timeout de
  // rede: o upload ja fechou, entao devolve o estado atual em vez de estourar.
  if (!meeting.uploadId) {
    if (meeting.status === "draft") throw new Error("meeting_upload_not_started");
    return meeting;
  }

  /*
   * A lista de partes vem do R2, nao do navegador.
   *
   * Duas razoes, e a segunda resolve um problema concreto:
   *  1. O cliente nao e fonte confiavel do que foi gravado no storage; o R2 e.
   *  2. Ler o ETag da resposta de cada PUT exigiria `ExposeHeaders: ["ETag"]`
   *     no CORS do bucket. Perguntar ao R2 elimina essa dependencia — o upload
   *     passa a funcionar com o CORS que o bucket ja tem para os materiais de
   *     agente, sem precisar de token com permissao de configuracao.
   */
  const parts = normalizeParts(
    await listR2MultipartParts({ key: meeting.storageKey, uploadId: meeting.uploadId }),
  );

  assertMeetingWithinPerFileLimits({
    plan: input.session.plan,
    durationMs: input.durationMs ?? null,
  });

  await completeR2MultipartUpload({
    key: meeting.storageKey,
    uploadId: meeting.uploadId,
    parts,
  });

  // Confia no objeto, nao no que o cliente disse que enviou.
  const head = await headR2Object(meeting.storageKey);
  if (!head || head.sizeBytes <= 0) throw new Error("meeting_upload_object_missing");

  assertMeetingWithinPerFileLimits({ plan: input.session.plan, sizeBytes: head.sizeBytes });

  const durationMs =
    typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs >= 0
      ? Math.min(Math.round(input.durationMs), 86_400_000)
      : null;

  const now = new Date().toISOString();
  const { data, error } = await input.sb
    .from("meetings")
    .update({
      upload_id: null,
      upload_parts: [],
      size_bytes: head.sizeBytes,
      duration_ms: durationMs,
      recorded_at: input.recordedAt ?? meeting.recordedAt ?? now,
      status: "queued",
      failed_reason: null,
      updated_at: now,
    })
    .eq("tenant_id", input.session.tenantId)
    .eq("id", input.meetingId)
    .select("*")
    .maybeSingle();

  if (error || !data) throw new Error("meeting_upload_complete_failed");

  // A partir daqui o trabalho e do pipeline. Enfileirar DEPOIS de o objeto
  // existir e de a linha estar consistente evita um worker acordar e encontrar
  // um audio pela metade.
  const { error: enqueueError } = await input.sb.rpc("enqueue_meeting_job_v1", {
    p_meeting_id: input.meetingId,
    p_tenant_id: input.session.tenantId,
    p_stage: "prepare",
    p_payload: {},
  });
  if (enqueueError) {
    // A reuniao esta salva e integra; so o disparo falhou. O watchdog de minuto
    // encontra `queued` sem job e reenfileira, entao nao se perde.
    console.error("[meeting-uploads] enqueue failed", enqueueError.message);
  }

  return toMeetingRecord(data as unknown as Record<string, unknown>);
}

export async function abortMeetingUpload(ctx: UploadContext): Promise<void> {
  const meeting = await loadOwnMeeting(ctx);
  if (!meeting) throw new Error("meeting_not_found");
  assertKeyBelongsToTenant(meeting.storageKey, ctx.session.tenantId);
  if (!meeting.uploadId) return;

  await abortR2MultipartUpload({ key: meeting.storageKey, uploadId: meeting.uploadId });

  await ctx.sb
    .from("meetings")
    .update({
      upload_id: null,
      upload_parts: [],
      status: "draft",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.session.tenantId)
    .eq("id", ctx.meetingId);
}
