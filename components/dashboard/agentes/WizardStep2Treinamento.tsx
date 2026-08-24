"use client";

import { AlertTriangle, CheckCircle2, Clock, FileText, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import type { TrainingFile, TrainingFileFormat } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AgentWizardDraft } from "@/lib/agents";
import { WizardStep2Instructions } from "./WizardStep2Instructions";
import { WizardStep2OutboundMedia } from "./WizardStep2OutboundMedia";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldLabel, FieldTitle } from "./agent-field-help";

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MATERIAL_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_MATERIAL_FILES = 5;
const R2_PUT_TIMEOUT_MS = 30_000;

const ACCEPT_EXTENSIONS =
  ".pdf,.docx,.xlsx,.pptx,.xml,.md,.markdown,.html,.htm,.csv,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.txt";

const TEMP_MIN = 0.01;
const TEMP_MAX = 1;

function isKnowledgeImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|tiff?|bmp)$/i.test(file.name);
}

function inferKnowledgeMimeType(file: File): string {
  if (file.type.trim()) return file.type.split(";")[0]!.trim().toLowerCase();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return (
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xml: "application/xml",
      md: "text/markdown",
      markdown: "text/markdown",
      html: "text/html",
      htm: "text/html",
      csv: "text/csv",
      txt: "text/plain",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      tif: "image/tiff",
      tiff: "image/tiff",
      bmp: "image/bmp",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

function inferTrainingFileFormat(fileName: string): TrainingFileFormat {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  const map: Record<string, TrainingFileFormat> = {
    ".pdf": "pdf",
    ".txt": "txt",
    ".doc": "docx",
    ".docx": "docx",
    ".xlsx": "xlsx",
    ".pptx": "pptx",
    ".xml": "xml",
    ".md": "md",
    ".markdown": "md",
    ".adoc": "adoc",
    ".html": "html",
    ".htm": "html",
    ".csv": "csv",
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".tif": "tiff",
    ".tiff": "tiff",
    ".bmp": "bmp",
  };
  return map[ext] ?? "txt";
}

type KnowledgeExtractStatus = NonNullable<import("@/lib/types").TrainingFile["extractedTextStatus"]>;

function mapUploadStatus(fileStatus: string): TrainingFile["status"] {
  if (fileStatus === "ready") return "ativo";
  if (fileStatus === "failed") return "erro";
  return "processando";
}

function MaterialExtractionBadge({ status }: { status: KnowledgeExtractStatus }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Conteúdo extraído
      </span>
    );
  }
  if (status === "unsupported") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Formato não suportado para extração
      </span>
    );
  }
  if (status === "pending" || status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-content-muted">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Aguardando extração
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-rose-500">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Falha na extração
    </span>
  );
}

function knowledgeErrorLabel(code: string | undefined): string | null {
  if (!code) return null;
  if (code.includes("no_extractable_text") || code.includes("no_chunks")) return "Nenhum texto legível foi encontrado.";
  if (code.includes("signature_invalid") || code.includes("encoding_invalid")) {
    return "O conteúdo do arquivo não corresponde ao formato informado.";
  }
  if (code.includes("page_limit")) return "O PDF ultrapassa o limite de páginas permitido.";
  if (code.includes("slide_limit")) return "A apresentação ultrapassa o limite de slides permitido.";
  if (code.includes("sheet_limit") || code.includes("cell_limit")) return "A planilha ultrapassa o limite de dados permitido.";
  if (code.includes("office_") && code.includes("limit")) return "O arquivo compactado ultrapassa o limite seguro de processamento.";
  if (code.includes("dead_letter")) return "O processamento falhou após todas as tentativas. Reprocesse o arquivo.";
  if (code.includes("claim_expired")) return "O processamento foi interrompido e será retomado automaticamente.";
  return "Não foi possível processar este material. Reprocesse ou envie outro arquivo.";
}

export function WizardStep2Treinamento({
  draft,
  onChange,
  agentId,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
  agentId?: string;
}) {
  const { isLight } = usePanelAppearance();
  const promptSizeUnits = useMemo(
    () =>
      Math.max(
        1,
        Math.round(
          (draft.promptIdentidade.length +
            draft.promptObjetivo.length +
            draft.systemPrompt.length +
            draft.promptRegrasAdicionais.length) /
            4,
        ),
      ),
    [draft.promptIdentidade, draft.promptObjetivo, draft.promptRegrasAdicionais, draft.systemPrompt],
  );

  const temperaturaClamped = Math.min(TEMP_MAX, Math.max(TEMP_MIN, draft.temperatura));
  const temperaturaPct = ((temperaturaClamped - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const [dragActive, setDragActive] = useState(false);
  const [materialError, setMaterialError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const canAddMaterials = draft.arquivosTreinamento.length < MAX_MATERIAL_FILES && Boolean(agentId);

  const materialMetrics = useMemo(() => {
    const files = draft.arquivosTreinamento;
    const activeCount = files.length;
    const totalBytes = files.reduce((sum, f) => {
      const raw =
        typeof f.sizeBytes === "number" && Number.isFinite(f.sizeBytes) && f.sizeBytes > 0 ? f.sizeBytes : f.tamanhoKb * 1024;
      return sum + Math.max(0, raw);
    }, 0);
    return {
      activeCount,
      totalBytes,
      fileBarPct: Math.min(100, (activeCount / MAX_MATERIAL_FILES) * 100),
      byteBarPct: Math.min(100, (totalBytes / MAX_MATERIAL_TOTAL_BYTES) * 100),
      totalKbRounded: Math.round(Math.max(0, totalBytes) / 1024),
    };
  }, [draft.arquivosTreinamento]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const syncServerFiles = useCallback(async () => {
    if (!agentId) return;
    setLoadingMaterials(true);
    try {
      const response = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}/knowledge-files`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        files?: Array<{
          id: string;
          originalFilename: string;
          sizeBytes: number;
          status: string;
          extractedTextStatus: KnowledgeExtractStatus;
          errorMessage?: string | null;
        }>;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Erro ao carregar materiais.");
      const files = Array.isArray(data.files) ? data.files : [];
      const currentDraft = draftRef.current;
      onChange({
        ...currentDraft,
        arquivosTreinamento: files.map((file) => ({
          id: file.id,
          nome: file.originalFilename,
          tipo: inferTrainingFileFormat(file.originalFilename),
          status: mapUploadStatus(file.status),
          extractedTextStatus: file.extractedTextStatus,
          extractionError: file.errorMessage ?? undefined,
          tamanhoKb: Math.max(1, Math.round(file.sizeBytes / 1024)),
          sizeBytes: file.sizeBytes,
        })),
      });
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : "Erro ao carregar materiais.");
    } finally {
      setLoadingMaterials(false);
    }
  }, [agentId, onChange]);

  useEffect(() => {
    void syncServerFiles();
  }, [syncServerFiles]);

  const hasProcessingMaterials = draft.arquivosTreinamento.some(
    (file) => file.extractedTextStatus === "pending" || file.extractedTextStatus === "processing",
  );
  useEffect(() => {
    if (!agentId || !hasProcessingMaterials) return;
    const timer = window.setInterval(() => {
      void syncServerFiles();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [agentId, hasProcessingMaterials, syncServerFiles]);

  const uploadToSignedUrl = useCallback((file: File, uploadUrl: string, mimeType: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timeoutId = window.setTimeout(() => {
        settle(() => {
          reject(
            new Error(
              "O envio do arquivo excedeu 30 segundos. Tente um arquivo menor ou verifique sua conexão.",
            ),
          );
        });
        xhr.abort();
      }, R2_PUT_TIMEOUT_MS);

      const clearTimer = () => window.clearTimeout(timeoutId);

      xhr.open("PUT", uploadUrl);
      xhr.timeout = R2_PUT_TIMEOUT_MS;
      xhr.setRequestHeader("Content-Type", mimeType);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        setUploadProgress((current) => ({
          ...current,
          [file.name]: Math.max(1, Math.round((event.loaded / event.total) * 99)),
        }));
      };

      xhr.onload = () => {
        clearTimer();
        settle(() => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          if (xhr.status === 0) {
            reject(
              new Error(
                "Não foi possível enviar o arquivo para o armazenamento (rede ou CORS). O upload não foi concluído — a extração não será iniciada.",
              ),
            );
            return;
          }
          reject(new Error(`Falha no upload para o armazenamento (HTTP ${xhr.status}).`));
        });
      };

      xhr.onerror = () => {
        clearTimer();
        settle(() => {
          reject(
            new Error(
              "Falha de rede ou CORS ao enviar o arquivo. Verifique sua conexão e se o bucket R2 permite upload a partir deste site.",
            ),
          );
        });
      };

      xhr.ontimeout = () => {
        clearTimer();
        settle(() => {
          reject(
            new Error(
              "O envio do arquivo excedeu 30 segundos. Tente um arquivo menor ou verifique sua conexão.",
            ),
          );
        });
      };

      xhr.onabort = () => {
        clearTimer();
        settle(() => {
          reject(new Error("Upload interrompido (timeout ou cancelamento). O arquivo não foi enviado por completo."));
        });
      };

      try {
        xhr.send(file);
      } catch (sendError) {
        clearTimer();
        console.error("[WizardStep2Treinamento] xhr.send failed", { fileName: file.name, sendError });
        settle(() => {
          reject(new Error("Não foi possível iniciar o envio do arquivo para o armazenamento."));
        });
      }
    });
  }, []);

  const completeKnowledgeUpload = useCallback(
    async (knowledgeFileId: string) => {
      const completeResponse = await fetch(
        `/api/client/agentes/${encodeURIComponent(agentId!)}/knowledge-files/${encodeURIComponent(knowledgeFileId)}`,
        { method: "POST" },
      );
      const completeData = (await completeResponse.json().catch(() => ({}))) as { error?: string };
      if (!completeResponse.ok) {
        throw new Error(completeData.error || "Erro ao concluir upload e extrair conteúdo.");
      }
    },
    [agentId],
  );

  const ingestFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      if (!agentId) {
        setMaterialError("Salve o agente uma vez antes de enviar materiais de apoio.");
        return;
      }
      if (draft.arquivosTreinamento.length + files.length > MAX_MATERIAL_FILES) {
        setMaterialError("Cada agente pode ter no máximo 5 materiais de apoio.");
        return;
      }
      const oversize = files.filter((file) => file.size > (isKnowledgeImage(file) ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES));
      const ok = files.filter((file) => file.size <= (isKnowledgeImage(file) ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES));
      if (oversize.length) {
        setMaterialError("Documentos podem ter até 50 MB e imagens até 20 MB.");
      } else {
        setMaterialError("");
      }
      if (!ok.length) return;
      const currentTotal = draft.arquivosTreinamento.reduce(
        (sum, file) => sum + Math.max(0, file.sizeBytes ?? file.tamanhoKb * 1024),
        0,
      );
      if (currentTotal + ok.reduce((sum, file) => sum + file.size, 0) > MAX_MATERIAL_TOTAL_BYTES) {
        setMaterialError("Os materiais deste agente não podem ultrapassar 200 MB no total.");
        return;
      }

      for (const file of ok) {
        let knowledgeFileId: string | null = null;
        let r2UploadSucceeded = false;

        try {
          setUploadProgress((current) => ({ ...current, [file.name]: 1 }));
          const mimeType = inferKnowledgeMimeType(file);

          const startResponse = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}/knowledge-files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              mimeType,
              sizeBytes: file.size,
            }),
          });
          const startData = (await startResponse.json().catch(() => ({}))) as {
            file?: { id: string };
            uploadUrl?: string;
            error?: string;
          };

          if (!startResponse.ok || !startData.file?.id || !startData.uploadUrl) {
            console.error("[WizardStep2Treinamento] knowledge upload start failed", {
              fileName: file.name,
              status: startResponse.status,
              startData,
            });
            throw new Error(startData.error || "Erro ao iniciar upload.");
          }

          knowledgeFileId = startData.file.id;

          await uploadToSignedUrl(file, startData.uploadUrl, mimeType);
          r2UploadSucceeded = true;
          setUploadProgress((current) => ({ ...current, [file.name]: 100 }));

          await completeKnowledgeUpload(knowledgeFileId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro ao enviar material.";
          console.error("[WizardStep2Treinamento] knowledge upload failed", {
            fileName: file.name,
            knowledgeFileId,
            r2UploadSucceeded,
            error,
          });
          setMaterialError(
            r2UploadSucceeded && knowledgeFileId
              ? `${message} O arquivo foi enviado, mas a extração não foi concluída — tente «Reprocessar» na lista.`
              : message,
          );
          if (knowledgeFileId && !r2UploadSucceeded) {
            await fetch(
              `/api/client/agentes/${encodeURIComponent(agentId)}/knowledge-files/${encodeURIComponent(knowledgeFileId)}`,
              { method: "DELETE" },
            ).catch(() => undefined);
          }
        } finally {
          setUploadProgress((current) => {
            const next = { ...current };
            delete next[file.name];
            return next;
          });
        }
      }

      await syncServerFiles();
    },
    [agentId, completeKnowledgeUpload, draft.arquivosTreinamento, syncServerFiles, uploadToSignedUrl],
  );

  const reprocessMaterial = useCallback(
    async (fileId: string) => {
      if (!agentId) return;
      setMaterialError("");
      setReprocessingId(fileId);
      try {
        const response = await fetch(
          `/api/client/agentes/${encodeURIComponent(agentId)}/knowledge-files/${encodeURIComponent(fileId)}/reprocess`,
          { method: "POST" },
        );
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Erro ao reprocessar material.");
        await syncServerFiles();
      } catch (error) {
        setMaterialError(error instanceof Error ? error.message : "Erro ao reprocessar material.");
      } finally {
        setReprocessingId(null);
      }
    },
    [agentId, syncServerFiles],
  );

  const removeMaterial = useCallback(
    async (fileId: string) => {
      if (!agentId) return;
      setMaterialError("");
      try {
        const response = await fetch(
          `/api/client/agentes/${encodeURIComponent(agentId)}/knowledge-files/${encodeURIComponent(fileId)}`,
          { method: "DELETE" },
        );
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Erro ao remover material.");
        onChange({
          ...draft,
          arquivosTreinamento: draft.arquivosTreinamento.filter((file) => file.id !== fileId),
        });
      } catch (error) {
        setMaterialError(error instanceof Error ? error.message : "Erro ao remover material.");
      }
    },
    [agentId, draft, onChange],
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <FieldLabel label="Tom de voz" help={AGENT_FIELD_HELP.tom} />
          <Select value={draft.tom} onChange={(event) => onChange({ ...draft, tom: event.target.value })}>
            <option>Formal</option>
            <option>Profissional</option>
            <option>Casual</option>
            <option>Descontraído</option>
            <option>Vendedor</option>
          </Select>
        </div>
        <div>
          <FieldLabel label="Velocidade simulada" help={AGENT_FIELD_HELP.velocidade} />
          <Select
            value={`${draft.delayResposta}`}
            onChange={(event) => onChange({ ...draft, delayResposta: Number(event.target.value) })}
          >
            <option value="0">Imediato</option>
            <option value="2">Parece humano (1-3s)</option>
            <option value="4">Lento (3-5s)</option>
          </Select>
        </div>
        <div>
          <FieldLabel label="Idioma do agente" help={AGENT_FIELD_HELP.idioma} />
          <Select value={draft.idioma} onChange={(event) => onChange({ ...draft, idioma: event.target.value })}>
            <option>Português BR</option>
            <option>Inglês</option>
            <option>Espanhol</option>
            <option>Automático</option>
          </Select>
        </div>
      </div>

      <WizardStep2Instructions
        draft={draft}
        onChange={onChange}
        promptSizeUnits={promptSizeUnits}
        temperaturaClamped={temperaturaClamped}
        temperaturaPct={temperaturaPct}
        isLight={isLight}
      />

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <FieldTitle title="Materiais de Apoio" help={AGENT_FIELD_HELP.materiaisApoio} />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_EXTENSIONS}
          className="sr-only"
          onChange={(event) => {
            void ingestFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        <div className="mt-4 space-y-2 rounded-xl border border-line bg-surface-elevated/20 px-3 py-3 text-xs">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-content-secondary">Ficheiros</span>
              <span className="tabular-nums text-content-faint">
                {materialMetrics.activeCount} / {MAX_MATERIAL_FILES}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-emerald-500/80 transition-[width]"
                style={{ width: `${materialMetrics.fileBarPct}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-content-secondary">Armazenamento</span>
              <span className="tabular-nums text-content-faint">
                {materialMetrics.totalKbRounded.toLocaleString("pt-BR")} KB / 200 MB
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-emerald-500/50 transition-[width]"
                style={{ width: `${materialMetrics.byteBarPct}%` }}
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!canAddMaterials}
          aria-label="Selecionar ou largar materiais de apoio"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canAddMaterials) return;
            setDragActive(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!canAddMaterials) return;
            setDragActive(true);
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
            if (draft.arquivosTreinamento.length >= MAX_MATERIAL_FILES || !agentId) return;
            void ingestFiles(event.dataTransfer.files);
          }}
          className={cn(
            "mt-4 flex w-full flex-col items-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition",
            !canAddMaterials ? "cursor-not-allowed opacity-55" : "cursor-pointer",
            dragActive && canAddMaterials
              ? "border-primary/50 bg-primary/[0.06]"
              : "border-line bg-surface-elevated/25 hover:border-primary/35 hover:bg-surface-elevated/40",
          )}
        >
          <Upload className="h-10 w-10 text-primary" strokeWidth={1.75} aria-hidden />
          <p className="mt-3 text-sm font-semibold text-content">Clique para selecionar ou arraste seus arquivos aqui</p>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-content-muted">
            Formatos aceitos: TXT, PDF, DOCX, XLSX, PPTX, XML, Markdown, HTML, CSV, PNG, JPEG, TIFF e BMP. Até 5 arquivos e 200 MB por agente; documentos até 50 MB e imagens até 20 MB.
          </p>
        </button>

        {!agentId ? (
          <p className="mt-2 text-xs text-content-faint">
            Para novos agentes, salve primeiro e reabra a edição para enviar materiais grandes com segurança.
          </p>
        ) : null}

        {materialError ? <p className="mt-2 text-xs text-rose-300">{materialError}</p> : null}
        {loadingMaterials ? (
          <p className="mt-3 inline-flex items-center gap-2 text-xs text-content-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Carregando materiais salvos…
          </p>
        ) : null}
        {Object.entries(uploadProgress).length > 0 ? (
          <div className="mt-3 space-y-2">
            {Object.entries(uploadProgress).map(([name, pct]) => (
              <div key={name} className="rounded-xl border border-line bg-surface-elevated/35 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-content-secondary">{name}</span>
                  <span className="shrink-0 tabular-nums text-content-faint">{pct}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {draft.arquivosTreinamento.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {draft.arquivosTreinamento.map((file) => (
              <li
                key={file.id}
                className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-elevated/35 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />
                    <span className="min-w-0 truncate text-content-secondary">{file.nome}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {agentId &&
                    (file.extractedTextStatus === "unsupported" || file.extractedTextStatus === "failed") ? (
                      <button
                        type="button"
                        disabled={reprocessingId === file.id}
                        onClick={() => void reprocessMaterial(file.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[10px] font-medium text-content-secondary transition hover:bg-surface-card disabled:opacity-50"
                        aria-label={`Reprocessar ${file.nome}`}
                      >
                        {reprocessingId === file.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <RefreshCw className="h-3 w-3" aria-hidden />
                        )}
                        Reprocessar
                      </button>
                    ) : null}
                    {agentId ? (
                      <button
                        type="button"
                        onClick={() => void removeMaterial(file.id)}
                        className="rounded-lg p-1.5 text-content-faint transition hover:bg-rose-500/10 hover:text-rose-300"
                        aria-label={`Remover ${file.nome}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </span>
                </div>
                {file.extractedTextStatus ? (
                  <MaterialExtractionBadge status={file.extractedTextStatus} />
                ) : null}
                {file.extractedTextStatus === "failed" && knowledgeErrorLabel(file.extractionError) ? (
                  <span className="text-[11px] leading-relaxed text-rose-300">
                    {knowledgeErrorLabel(file.extractionError)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <WizardStep2OutboundMedia agentId={agentId} />
    </div>
  );
}
