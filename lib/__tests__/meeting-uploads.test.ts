/**
 * Upload multipart das reunioes.
 *
 * O que esta suite protege, em ordem de gravidade: a chave nunca sair do
 * prefixo do tenant, o multipart nunca ficar orfao no bucket, e o audio nunca
 * ser montado fora de ordem (que produz gravacao embaralhada, nao erro).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/lib/client-auth";
import type { AccessScope } from "@/lib/server/access-scope";
import type { MeetingRecord } from "@/lib/server/meetings-db";

const r2 = vi.hoisted(() => ({
  createR2MultipartUpload: vi.fn(async () => "upload-1"),
  createR2PresignedPartUrl: vi.fn(async () => "https://r2.example/part"),
  completeR2MultipartUpload: vi.fn(async () => undefined),
  abortR2MultipartUpload: vi.fn(async () => undefined),
  listR2MultipartParts: vi.fn(async () => [] as Array<{ partNumber: number; etag: string }>),
  headR2Object: vi.fn(async () => ({ sizeBytes: 1024, contentType: "audio/webm" })),
  getR2BucketName: vi.fn(() => "mychatcrm-media"),
  R2_MIN_PART_BYTES: 5 * 1024 * 1024,
  R2_MAX_PARTS: 10_000,
}));

const db = vi.hoisted(() => ({ getMeetingForSession: vi.fn() }));
const quota = vi.hoisted(() => ({
  assertMeetingQuotaAvailable: vi.fn(async () => undefined),
  assertMeetingWithinPerFileLimits: vi.fn(() => undefined),
}));

vi.mock("@/lib/integrations/r2-storage", () => r2);
vi.mock("@/lib/server/meeting-quota", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...quota,
}));
vi.mock("@/lib/server/meetings-db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMeetingForSession: db.getMeetingForSession,
}));

const {
  abortMeetingUpload,
  completeMeetingUpload,
  createMeetingUploadPartUrls,
  getMeetingUploadStatus,
  startMeetingUpload,
} = await import("@/lib/server/meeting-uploads");

const SCOPE: AccessScope = { kind: "all" };

function session(): ClientSession {
  return {
    token: "t",
    tenantId: "tenant-a",
    email: "u@e.com",
    displayName: "U",
    companyName: "T",
    plan: "equipa",
    planLabel: "Equipa",
    initials: "U",
    status: "ativa",
  };
}

function meeting(patch: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: "m-1",
    tenantId: "tenant-a",
    createdByEmployeeId: null,
    teamId: null,
    leadId: null,
    title: "",
    meetingType: "geral",
    language: "pt",
    source: "record",
    tags: [],
    visibility: "company",
    status: "draft",
    storageBucket: "",
    storageKey: "meetings/tenant-a/m-1/audio.webm",
    sizeBytes: 0,
    mimeType: "audio/webm",
    uploadId: null,
    durationMs: null,
    recordedAt: null,
    processingVersion: 1,
    provider: null,
    userNotes: "",
    retentionUntil: null,
    audioDeletedAt: null,
    failedReason: null,
    createdAt: "",
    updatedAt: "",
    ...patch,
  };
}

/** Supabase falso: registra updates e rpc, devolve a linha configurada. */
function fakeSupabase(options: { updateError?: string; updatedRow?: Record<string, unknown> } = {}) {
  const calls = { updates: [] as Array<Record<string, unknown>>, rpc: [] as string[] };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in"]) chain[m] = () => chain;
  chain.update = (patch: Record<string, unknown>) => {
    calls.updates.push(patch);
    return chain;
  };
  chain.maybeSingle = () =>
    Promise.resolve({
      data: options.updatedRow ?? { id: "m-1", tenant_id: "tenant-a", status: "queued", source: "record" },
      error: options.updateError ? { message: options.updateError } : null,
    });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: options.updateError ? { message: options.updateError } : null }).then(resolve);

  const sb = {
    from: () => chain,
    rpc: (name: string) => {
      calls.rpc.push(name);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { sb: sb as never, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  r2.createR2MultipartUpload.mockResolvedValue("upload-1");
  r2.headR2Object.mockResolvedValue({ sizeBytes: 1024, contentType: "audio/webm" });
  r2.listR2MultipartParts.mockResolvedValue([]);
  quota.assertMeetingQuotaAvailable.mockResolvedValue(undefined);
  quota.assertMeetingWithinPerFileLimits.mockReturnValue(undefined);
});

// ── Isolamento ──────────────────────────────────────────────────────────────

describe("isolamento entre empresas", () => {
  it("recusa reuniao fora do escopo em todas as operacoes de upload", async () => {
    db.getMeetingForSession.mockResolvedValue(null);
    const { sb } = fakeSupabase();
    const ctx = { sb, session: session(), scope: SCOPE, meetingId: "m-de-outro" };

    await expect(startMeetingUpload(ctx)).rejects.toThrow("meeting_not_found");
    await expect(createMeetingUploadPartUrls({ ...ctx, partNumbers: [1] })).rejects.toThrow("meeting_not_found");
    await expect(getMeetingUploadStatus(ctx)).rejects.toThrow("meeting_not_found");
    await expect(completeMeetingUpload({ ...ctx })).rejects.toThrow("meeting_not_found");
    await expect(abortMeetingUpload(ctx)).rejects.toThrow("meeting_not_found");
  });

  it("recusa assinar URL quando a chave nao esta sob o prefixo do tenant", async () => {
    // Cenario de defesa em profundidade: mesmo que a linha chegue corrompida, a
    // assinatura nao acontece.
    db.getMeetingForSession.mockResolvedValue(
      meeting({ storageKey: "meetings/tenant-b/m-1/audio.webm", uploadId: "upload-1" }),
    );
    const { sb } = fakeSupabase();
    await expect(
      createMeetingUploadPartUrls({ sb, session: session(), scope: SCOPE, meetingId: "m-1", partNumbers: [1] }),
    ).rejects.toThrow("meeting_storage_key_outside_tenant");
    expect(r2.createR2PresignedPartUrl).not.toHaveBeenCalled();
  });
});

// ── start ───────────────────────────────────────────────────────────────────

describe("startMeetingUpload", () => {
  it("bloqueia quando a cota do mes acabou", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting());
    quota.assertMeetingQuotaAvailable.mockRejectedValue(new Error("meeting_quota_exceeded"));
    const { sb } = fakeSupabase();
    await expect(
      startMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" }),
    ).rejects.toThrow("meeting_quota_exceeded");
    expect(r2.createR2MultipartUpload).not.toHaveBeenCalled();
  });

  it("retoma o multipart existente em vez de abrir outro", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: "upload-antigo", status: "uploading" }));
    const { sb } = fakeSupabase();
    const result = await startMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" });

    expect(result.uploadId).toBe("upload-antigo");
    // Abrir um segundo deixaria o primeiro orfao, ocupando espaco invisivel.
    expect(r2.createR2MultipartUpload).not.toHaveBeenCalled();
  });

  it("recusa reabrir upload de reuniao ja processada", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting({ status: "completed" }));
    const { sb } = fakeSupabase();
    await expect(
      startMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" }),
    ).rejects.toThrow("meeting_upload_already_finished");
  });

  it("aborta o multipart quando a gravacao da linha falha", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting());
    const { sb } = fakeSupabase({ updateError: "boom" });
    await expect(
      startMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" }),
    ).rejects.toThrow("meeting_upload_start_failed");
    // Sem a linha apontando para ele, o multipart seria invisivel para sempre.
    expect(r2.abortR2MultipartUpload).toHaveBeenCalledWith({
      key: "meetings/tenant-a/m-1/audio.webm",
      uploadId: "upload-1",
    });
  });
});

// ── part-urls ───────────────────────────────────────────────────────────────

describe("createMeetingUploadPartUrls", () => {
  beforeEach(() => {
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: "upload-1", status: "uploading" }));
  });

  it("recusa lote maior que o limite por requisicao", async () => {
    const { sb } = fakeSupabase();
    const partNumbers = Array.from({ length: 21 }, (_, i) => i + 1);
    await expect(
      createMeetingUploadPartUrls({ sb, session: session(), scope: SCOPE, meetingId: "m-1", partNumbers }),
    ).rejects.toThrow("meeting_part_batch_invalid");
  });

  it("recusa numero de parte fora do intervalo do protocolo", async () => {
    const { sb } = fakeSupabase();
    for (const bad of [0, -1, 10_001, 1.5]) {
      await expect(
        createMeetingUploadPartUrls({ sb, session: session(), scope: SCOPE, meetingId: "m-1", partNumbers: [bad] }),
      ).rejects.toThrow("meeting_part_number_invalid");
    }
  });

  it("deduplica e ordena os numeros pedidos", async () => {
    const { sb } = fakeSupabase();
    const urls = await createMeetingUploadPartUrls({
      sb,
      session: session(),
      scope: SCOPE,
      meetingId: "m-1",
      partNumbers: [3, 1, 3, 2],
    });
    expect(urls.map((u) => u.partNumber)).toEqual([1, 2, 3]);
  });

  it("exige que o upload tenha sido iniciado", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: null }));
    const { sb } = fakeSupabase();
    await expect(
      createMeetingUploadPartUrls({ sb, session: session(), scope: SCOPE, meetingId: "m-1", partNumbers: [1] }),
    ).rejects.toThrow("meeting_upload_not_started");
  });
});

// ── complete ────────────────────────────────────────────────────────────────

describe("completeMeetingUpload", () => {
  beforeEach(() => {
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: "upload-1", status: "uploading" }));
    // A verdade sobre o que subiu vem do R2, nao do cliente.
    r2.listR2MultipartParts.mockResolvedValue([
      { partNumber: 2, etag: "b" },
      { partNumber: 1, etag: "a" },
    ]);
  });

  it("usa a lista do R2 e IGNORA as partes enviadas pelo cliente", async () => {
    const { sb } = fakeSupabase();
    await completeMeetingUpload({
      sb,
      session: session(),
      scope: SCOPE,
      meetingId: "m-1",
      // Cliente mentindo: parte inexistente com etag inventado.
      parts: [{ partNumber: 99, etag: "forjado" }],
    });

    const sent = r2.completeR2MultipartUpload.mock.calls[0]?.[0] as {
      parts: Array<{ partNumber: number; etag: string }>;
    };
    expect(sent.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(sent.parts.some((p) => p.etag === "forjado")).toBe(false);
  });

  it("ordena as partes antes de fechar — fora de ordem produz audio embaralhado", async () => {
    const { sb } = fakeSupabase();
    r2.listR2MultipartParts.mockResolvedValue([
      { partNumber: 3, etag: "c" },
      { partNumber: 1, etag: "a" },
      { partNumber: 2, etag: "b" },
    ]);
    await completeMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" });

    const sent = r2.completeR2MultipartUpload.mock.calls[0]?.[0] as {
      parts: Array<{ partNumber: number }>;
    };
    expect(sent.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });

  it("recusa fechar quando o R2 nao tem nenhuma parte", async () => {
    r2.listR2MultipartParts.mockResolvedValue([]);
    const { sb } = fakeSupabase();
    await expect(
      completeMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" }),
    ).rejects.toThrow("meeting_parts_invalid");
  });

  it("confia no objeto do R2, nao no que o cliente disse ter enviado", async () => {
    r2.headR2Object.mockResolvedValue(null);
    const { sb } = fakeSupabase();
    await expect(
      completeMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" }),
    ).rejects.toThrow("meeting_upload_object_missing");
  });

  it("enfileira o processamento so depois de o objeto existir", async () => {
    const { sb, calls } = fakeSupabase();
    await completeMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" });
    expect(calls.rpc).toContain("enqueue_meeting_job_v1");
  });

  it("e idempotente: segunda chamada devolve a reuniao em vez de estourar", async () => {
    // Duplo clique em "Finalizar", ou retry depois de um timeout de rede.
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: null, status: "queued" }));
    const { sb } = fakeSupabase();
    const result = await completeMeetingUpload({
      sb,
      session: session(),
      scope: SCOPE,
      meetingId: "m-1",
    });
    expect(result.status).toBe("queued");
    expect(r2.completeR2MultipartUpload).not.toHaveBeenCalled();
  });

  it("recusa finalizar quando o upload nunca comecou", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: null, status: "draft" }));
    const { sb } = fakeSupabase();
    await expect(
      completeMeetingUpload({ sb, session: session(), scope: SCOPE, meetingId: "m-1" }),
    ).rejects.toThrow("meeting_upload_not_started");
  });
});

// ── status / retomada ───────────────────────────────────────────────────────

describe("getMeetingUploadStatus", () => {
  it("aponta a proxima parte a partir do que ja esta no R2", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: "upload-1", status: "uploading" }));
    r2.listR2MultipartParts.mockResolvedValue([
      { partNumber: 1, etag: "a" },
      { partNumber: 2, etag: "b" },
    ]);
    const { sb } = fakeSupabase();
    const status = await getMeetingUploadStatus({ sb, session: session(), scope: SCOPE, meetingId: "m-1" });

    expect(status.nextPartNumber).toBe(3);
    expect(status.uploadedParts).toHaveLength(2);
  });

  it("comeca do zero quando nao ha upload aberto", async () => {
    db.getMeetingForSession.mockResolvedValue(meeting({ uploadId: null }));
    const { sb } = fakeSupabase();
    const status = await getMeetingUploadStatus({ sb, session: session(), scope: SCOPE, meetingId: "m-1" });
    expect(status.nextPartNumber).toBe(1);
    expect(status.uploadId).toBeNull();
  });
});
