"use client";

import { AlertTriangle, CheckCircle2, Clock, FileText, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import type { TrainingFile, TrainingFileFormat } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AgentWizardDraft } from "@/lib/agents";
import { WizardStep2Instructions } from "./WizardStep2Instructions";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

const MAX_MATERIAL_BYTES = 1024 * 1024 * 1024;
const MAX_MATERIAL_FILES = 50;

const ACCEPT_EXTENSIONS =
  ".pdf,.docx,.xlsx,.pptx,.xml,.md,.markdown,.html,.htm,.csv,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.txt";

const TEMP_MIN = 0.01;
const TEMP_MAX = 1;

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

export function WizardStep2Treinamento({
  draft,
  onChange,
  onGeneratePrompt,
  agentId,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
  onGeneratePrompt: () => void;
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
          tamanhoKb: Math.max(1, Math.round(file.sizeBytes / 1024)),
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

  const uploadToSignedUrl = useCallback((file: File, uploadUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        setUploadProgress((current) => ({
          ...current,
          [file.name]: Math.round((event.loaded / event.total) * 100),
        }));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error("Falha no upload para o R2."));
      };
      xhr.onerror = () => reject(new Error("Falha de rede no upload para o R2."));
      xhr.send(file);
    });
  }, []);

  const ingestFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      if (!agentId) {
        setMaterialError("Salve o agente uma vez antes de enviar materiais de apoio.");
        return;
      }
      if (draft.arquivosTreinamento.length + files.length > MAX_MATERIAL_FILES) {
        setMaterialError("Cada agente pode ter no máximo 50 materiais de apoio.");
        return;
      }
      const oversize = files.filter((f) => f.size > MAX_MATERIAL_BYTES);
      const ok = files.filter((f) => f.size <= MAX_MATERIAL_BYTES);
      if (oversize.length) {
        setMaterialError("Cada arquivo deve ter no máximo 1GB.");
      } else {
        setMaterialError("");
      }
      if (!ok.length) return;
      for (const file of ok) {
        try {
          setUploadProgress((current) => ({ ...current, [file.name]: 1 }));
          const startResponse = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}/knowledge-files`, {
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
          if (!startResponse.ok || !startData.file || !startData.uploadUrl) {
            throw new Error(startData.error || "Erro ao iniciar upload.");
          }
          await uploadToSignedUrl(file, startData.uploadUrl);
          setUploadProgress((current) => ({ ...current, [file.name]: 100 }));
          const completeResponse = await fetch(
            `/api/client/agentes/${encodeURIComponent(agentId)}/knowledge-files/${encodeURIComponent(startData.file.id)}`,
            { method: "POST" },
          );
          const completeData = (await completeResponse.json().catch(() => ({}))) as { error?: string };
          if (!completeResponse.ok) throw new Error(completeData.error || "Erro ao concluir upload.");
        } catch (error) {
          setMaterialError(error instanceof Error ? error.message : "Erro ao enviar material.");
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
    [agentId, draft, syncServerFiles, uploadToSignedUrl],
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
          <label className="text-xs text-content-faint">Tom de voz</label>
          <Select value={draft.tom} onChange={(event) => onChange({ ...draft, tom: event.target.value })}>
            <option>Formal</option>
            <option>Profissional</option>
            <option>Casual</option>
            <option>Descontraído</option>
            <option>Vendedor</option>
          </Select>
        </div>
        <div>
          <label className="text-xs text-content-faint">Velocidade simulada</label>
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
          <label className="text-xs text-content-faint">Idioma do agente</label>
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
        onGeneratePrompt={onGeneratePrompt}
        promptSizeUnits={promptSizeUnits}
        temperaturaClamped={temperaturaClamped}
        temperaturaPct={temperaturaPct}
        isLight={isLight}
      />

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <p className="text-sm font-semibold text-content">Materiais de Apoio</p>
        <p className="mt-1 text-xs text-content-muted">
          Adicione materiais de suporte para ajudar o agente a responder perguntas específicas
        </p>

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

        <button
          type="button"
          aria-label="Selecionar ou largar materiais de apoio"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragActive(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
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
            void ingestFiles(event.dataTransfer.files);
          }}
          className={cn(
            "mt-4 flex w-full cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition",
            dragActive
              ? "border-primary/50 bg-primary/[0.06]"
              : "border-line bg-surface-elevated/25 hover:border-primary/35 hover:bg-surface-elevated/40",
          )}
        >
          <Upload className="h-10 w-10 text-primary" strokeWidth={1.75} aria-hidden />
          <p className="mt-3 text-sm font-semibold text-content">Clique para selecionar ou arraste seus arquivos aqui</p>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-content-muted">
            Formatos aceitos: PDF, DOCX, XLSX, PPTX, XML, Markdown, HTML, CSV, PNG, JPEG, TIFF e BMP. Até 50 arquivos por agente e 1GB por arquivo, com upload direto para R2.
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
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <p className="text-sm font-semibold text-content">Pausa humana por conversa</p>
        <p className="mt-1 text-xs text-content-faint">
          Defina frases enviadas no chat com o cliente. Quando o número da empresa enviar a frase de pausa, o agente deixa de responder{" "}
          <span className="font-medium text-content-muted">só naquela conversa</span> — por exemplo, você assumiu o atendimento no WhatsApp. A
          frase de retoma volta a ativar o agente na mesma conversa. Na integração com o canal, use a mesma frase configurada aqui (normalmente
          comparação exata ao texto da mensagem).
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-content-faint">Mensagem para pausar o agente (esta conversa)</label>
            <input
              type="text"
              value={draft.comandoPausaConversa}
              onChange={(event) => onChange({ ...draft, comandoPausaConversa: event.target.value })}
              placeholder='Ex.: "Oi cheguei"'
              className="mt-1 w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-2.5 text-sm text-content outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-content-faint">Mensagem para reativar o agente (esta conversa)</label>
            <input
              type="text"
              value={draft.comandoRetomaConversa}
              onChange={(event) => onChange({ ...draft, comandoRetomaConversa: event.target.value })}
              placeholder='Ex.: "Oi, ainda tem interesse?"'
              className="mt-1 w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-2.5 text-sm text-content outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
