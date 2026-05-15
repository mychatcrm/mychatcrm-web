"use client";

import { File as FileIcon, FileImage, Film, Loader2, Music, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_FILES = 50;
const TOTAL_CAP_BYTES = 1024 * 1024 * 1024;
/** Timeout maior que materiais — vídeos em redes lentas. */
const R2_PUT_TIMEOUT_MS = 120_000;

type ApiOutboundFile = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  status: string;
};

function formatMb(bytes: number): string {
  return (Math.max(bytes, 0) / (1024 * 1024)).toFixed(1).replace(".", ",");
}

function shortMime(m: string): string {
  const base = m.split(";")[0]?.trim() ?? m;
  return base.length > 28 ? `${base.slice(0, 26)}…` : base;
}

export function WizardStep2OutboundMedia({ agentId }: { agentId?: string }) {
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<ApiOutboundFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [descDraft, setDescDraft] = useState<Record<string, string>>({});

  const metrics = useMemo(() => {
    const active = mediaFiles.filter((f) => f.status !== "failed");
    const activeCount = active.length;
    const activeBytes = active.reduce((s, f) => s + Math.max(0, f.sizeBytes), 0);
    return {
      activeCount,
      activeBytes,
      fileBarPct: Math.min(100, (activeCount / MAX_FILES) * 100),
      byteBarPct: Math.min(100, (activeBytes / TOTAL_CAP_BYTES) * 100),
      totalMb: activeBytes / (1024 * 1024),
    };
  }, [mediaFiles]);

  const overlayBlocked =
    Boolean(!agentId) || metrics.activeCount >= MAX_FILES || metrics.activeBytes >= TOTAL_CAP_BYTES;

  const syncMediaFiles = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}/media-files`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        files?: ApiOutboundFile[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Erro ao carregar arquivos de envio.");
      setMediaFiles(Array.isArray(data.files) ? data.files : []);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Erro ao carregar mídia.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void syncMediaFiles();
  }, [syncMediaFiles]);

  const uploadToSignedUrl = useCallback((file: File, uploadUrl: string, progressKey: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timeoutId = window.setTimeout(() => {
        settle(() =>
          reject(
            new Error(
              `O envio excedeu ${Math.round(R2_PUT_TIMEOUT_MS / 1000)}s. Experimente um ficheiro mais pequeno ou outra rede.`,
            ),
          ),
        );
        xhr.abort();
      }, R2_PUT_TIMEOUT_MS);

      const clearTimer = () => window.clearTimeout(timeoutId);

      xhr.open("PUT", uploadUrl);
      xhr.timeout = R2_PUT_TIMEOUT_MS;
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        setUploadProgress((current) => ({
          ...current,
          [progressKey]: Math.max(1, Math.round((event.loaded / event.total) * 99)),
        }));
      };

      xhr.onload = () => {
        clearTimer();
        settle(() => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Falha no upload (HTTP ${xhr.status}).`));
        });
      };

      xhr.onerror = () => {
        clearTimer();
        settle(() =>
          reject(new Error("Erro de rede ou CORS ao enviar para o armazenamento — o upload pode não estar concluído.")),
        );
      };

      xhr.ontimeout = () => {
        clearTimer();
        settle(() => reject(new Error("Timeout ao enviar o ficheiro.")));
      };

      try {
        xhr.send(file);
      } catch {
        clearTimer();
        settle(() => reject(new Error("Não foi possível iniciar o envio.")));
      }
    });
  }, []);

  const ingestOutbound = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      if (!agentId) {
        setMediaError("Guarde o agente uma vez antes de enviar ficheiros de mídia.");
        return;
      }

      const snapshot = [...mediaFiles];
      const active = snapshot.filter((f) => f.status !== "failed");
      const remainingSlots = MAX_FILES - active.length;
      if (remainingSlots <= 0) {
        setMediaError(`Limite de ${MAX_FILES} ficheiros de envio atingido.`);
        return;
      }
      let usedBytesLocal = active.reduce((s, f) => s + Math.max(0, f.sizeBytes), 0);

      if (TOTAL_CAP_BYTES - usedBytesLocal <= 0) {
        setMediaError("Limite de 1GB de mídia por agente atingido.");
        return;
      }

      const accepted = Math.min(files.length, remainingSlots);
      if (files.length > accepted) {
        setMediaError(`Só podem ficar mais ${remainingSlots} ficheiros (máx. ${MAX_FILES}).`);
      } else {
        setMediaError("");
      }

      for (let i = 0; i < accepted; i += 1) {
        const file = files[i]!;
        const quotaLeft = TOTAL_CAP_BYTES - usedBytesLocal;
        if (file.size > quotaLeft) {
          setMediaError("Este ficheiro excede o espaço disponível dentro do limite de 1GB.");
          continue;
        }
        let mediaFileId: string | null = null;
        let r2Succeeded = false;
        const progressKey = `${file.name}__${file.size}__${i}`;

        try {
          setUploadProgress((current) => ({ ...current, [progressKey]: 1 }));

          const startResponse = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}/media-files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size,
            }),
          });

          const startData = (await startResponse.json().catch(() => ({}))) as {
            file?: { id: string };
            uploadUrl?: string;
            error?: string;
          };

          if (!startResponse.ok || !startData.file?.id || !startData.uploadUrl) {
            throw new Error(startData.error || "Erro ao iniciar upload.");
          }

          mediaFileId = startData.file.id;

          await uploadToSignedUrl(file, startData.uploadUrl, progressKey);
          r2Succeeded = true;
          setUploadProgress((current) => ({ ...current, [progressKey]: 100 }));

          const completeResponse = await fetch(
            `/api/client/agentes/${encodeURIComponent(agentId)}/media-files/${encodeURIComponent(mediaFileId)}`,
            { method: "POST" },
          );
          const completeData = (await completeResponse.json().catch(() => ({}))) as { error?: string };
          if (!completeResponse.ok) {
            throw new Error(completeData.error || "Erro ao concluir upload.");
          }
          usedBytesLocal += file.size;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro no upload.";
          setMediaError(
            r2Succeeded && mediaFileId
              ? `${message} Se o armazenamento ficou inconsistente, remova o registo da lista.`
              : message,
          );
        } finally {
          setUploadProgress((current) => {
            const next = { ...current };
            delete next[progressKey];
            return next;
          });
        }
        await syncMediaFiles();
      }
    },
    [agentId, mediaFiles, syncMediaFiles, uploadToSignedUrl],
  );

  const saveDescription = useCallback(
    async (fileId: string, raw: string) => {
      if (!agentId) return;
      const description = raw.trim();
      const current = mediaFiles.find((m) => m.id === fileId);
      const previous = current?.description?.trim() ?? "";
      if (description === previous) return;

      try {
        const response = await fetch(
          `/api/client/agentes/${encodeURIComponent(agentId)}/media-files/${encodeURIComponent(fileId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: description || null }),
          },
        );
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Erro ao guardar descrição.");
        await syncMediaFiles();
      } catch (e) {
        setMediaError(e instanceof Error ? e.message : "Erro ao guardar descrição.");
      }
    },
    [agentId, mediaFiles, syncMediaFiles],
  );

  const removeOutbound = useCallback(
    async (fileId: string) => {
      if (!agentId) return;
      setMediaError("");
      try {
        const response = await fetch(
          `/api/client/agentes/${encodeURIComponent(agentId)}/media-files/${encodeURIComponent(fileId)}`,
          { method: "DELETE" },
        );
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Erro ao remover ficheiro.");
        await syncMediaFiles();
      } catch (e) {
        setMediaError(e instanceof Error ? e.message : "Erro ao remover.");
      }
    },
    [agentId, syncMediaFiles],
  );

  function mediaIcon(kind: "image" | "video" | "audio" | "file") {
    if (kind === "video") return <Film className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />;
    if (kind === "audio") return <Music className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />;
    if (kind === "image") return <FileImage className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />;
    return <FileIcon className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />;
  }

  function kindFromMime(m: string): "image" | "video" | "audio" | "file" {
    const lower = m.toLowerCase().split(";")[0] ?? "";
    if (lower.startsWith("audio/")) return "audio";
    if (lower.startsWith("video/")) return "video";
    if (lower.startsWith("image/")) return "image";
    return "file";
  }

  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
      <p className="text-sm font-semibold text-content">Arquivos para Envio</p>
      <p className="mt-1 text-xs text-content-muted">
        Adicione qualquer tipo de arquivo que o agente pode enviar aos clientes: imagens, vídeos, áudios, PDFs, documentos e mais. Máximo 50 arquivos, 1GB por agente.
      </p>

      <input
        ref={mediaInputRef}
        type="file"
        multiple
        accept="*/*"
        className="sr-only"
        disabled={overlayBlocked}
        onChange={(event) => {
          void ingestOutbound(event.target.files);
          event.currentTarget.value = "";
        }}
      />

      <div className="mt-4 space-y-2 rounded-xl border border-line bg-surface-elevated/20 px-3 py-3 text-xs">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-content-secondary">Ficheiros</span>
            <span className="tabular-nums text-content-faint">{metrics.activeCount} / {MAX_FILES}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-emerald-500/80 transition-[width]"
              style={{ width: `${metrics.fileBarPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-content-secondary">Armazenamento</span>
            <span className="tabular-nums text-content-faint">{formatMb(metrics.activeBytes)} MB / 1024 MB</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-emerald-500/50 transition-[width]"
              style={{ width: `${metrics.byteBarPct}%` }}
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={overlayBlocked}
        aria-label="Seleccionar ou largar arquivos para envio"
        onClick={() => mediaInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!overlayBlocked) setDragActive(true);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!overlayBlocked) setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
          if (!overlayBlocked) void ingestOutbound(event.dataTransfer.files);
        }}
        className={cn(
          "mt-4 flex w-full flex-col items-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition",
          overlayBlocked
            ? "cursor-not-allowed opacity-55"
            : "cursor-pointer",
          dragActive && !overlayBlocked
            ? "border-emerald-500/50 bg-emerald-500/[0.06]"
            : "border-line bg-surface-elevated/25 hover:border-emerald-500/35 hover:bg-surface-elevated/40",
        )}
      >
        <Upload className="h-10 w-10 text-emerald-500" strokeWidth={1.75} aria-hidden />
        <p className="mt-3 text-sm font-semibold text-content">Clique ou arraste qualquer ficheiro</p>
        <p className="mt-2 max-w-lg text-xs leading-relaxed text-content-muted">
          Qualquer extensão permitida. O agente vê esta lista no prompt; no WhatsApp o modelo pode marcar o envio com{" "}
          <span className="font-mono text-[10px]">[[ENVIAR_MEDIA:nome.ext]]</span> (removida antes do cliente ver).
        </p>
      </button>

      {!agentId ? (
        <p className="mt-2 text-xs text-content-faint">
          Guarde o agente e reabra a edição para fazer uploads seguros diretamente para o R2.
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-content-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> a carregar ficheiros de envio…
        </p>
      ) : null}

      {mediaError ? <p className="mt-2 text-xs text-rose-300">{mediaError}</p> : null}

      {Object.entries(uploadProgress).length > 0 ? (
        <div className="mt-3 space-y-2">
          {Object.entries(uploadProgress).map(([name, pct]) => (
            <div key={name} className="rounded-xl border border-line bg-surface-elevated/35 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-content-secondary">{name}</span>
                <span className="tabular-nums text-content-faint">{pct}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {mediaFiles.filter((m) => m.status !== "failed").length > 0 ? (
        <ul className="mt-4 space-y-2">
          {mediaFiles.map((file) =>
            file.status === "failed" ? null : (
              <li
                key={file.id}
                className="flex flex-col gap-2 rounded-xl border border-line bg-surface-elevated/35 px-3 py-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {mediaIcon(kindFromMime(file.mimeType))}
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-content-secondary">{file.originalFilename}</span>
                      <span className="text-content-faint">
                        {shortMime(file.mimeType)} · {formatMb(file.sizeBytes)} MB
                        {file.status === "uploading" ? <span className="ml-1 text-amber-400">· a sincronizar</span> : null}
                      </span>
                    </span>
                  </span>
                  {agentId ? (
                    <button
                      type="button"
                      onClick={() => void removeOutbound(file.id)}
                      className="rounded-lg p-1.5 text-content-faint transition hover:bg-rose-500/10 hover:text-rose-300"
                      aria-label={`Remover ${file.originalFilename}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <label htmlFor={`media-desc-${file.id}`} className="sr-only">
                  Descrição opcional para {file.originalFilename}
                </label>
                <textarea
                  id={`media-desc-${file.id}`}
                  rows={2}
                  value={descDraft[file.id] ?? file.description ?? ""}
                  placeholder="Descrição opcional — quando usar este arquivo (só para o modelo)"
                  className="w-full resize-y rounded-lg border border-line bg-surface-card px-2 py-1.5 text-xs text-content outline-none placeholder:text-content-faint"
                  onFocus={() =>
                    setDescDraft((draft) =>
                      draft[file.id] !== undefined ? draft : { ...draft, [file.id]: file.description ?? "" },
                    )
                  }
                  onChange={(e) => setDescDraft((draft) => ({ ...draft, [file.id]: e.target.value }))}
                  onBlur={(e) => void saveDescription(file.id, e.target.value)}
                />
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
