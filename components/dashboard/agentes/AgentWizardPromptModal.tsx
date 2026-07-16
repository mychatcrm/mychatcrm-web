"use client";

import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Modal } from "@/components/ui/Modal";
import type { AgentWizardDraft } from "@/lib/agents";
import { buildSimplePromptFromProFields } from "@/lib/agents";
import type { GeneratedAgentInstructions } from "@/lib/agents/wizard-generated-instructions";

export const WIZARD_PROMPT_MAX_FILES = 10;
export const WIZARD_PROMPT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/jpeg,image/png,image/webp";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentWizardPromptModal({
  open,
  onClose,
  draft,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  draft: AgentWizardDraft;
  onApply: (next: AgentWizardDraft, fileWarnings: string[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const resetAndClose = () => {
    if (loading) return;
    setDescription("");
    setFiles([]);
    setError("");
    onClose();
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    setError("");
    const next = [...files];
    for (let i = 0; i < incoming.length; i++) {
      const file = incoming.item(i);
      if (!file) continue;
      if (next.length >= WIZARD_PROMPT_MAX_FILES) {
        setError(`Máximo de ${WIZARD_PROMPT_MAX_FILES} arquivos.`);
        break;
      }
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError("Descreva o negócio ou o agente antes de gerar.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("description", description.trim());
      formData.append(
        "draft",
        JSON.stringify({
          nome: draft.nome,
          tom: draft.tom,
          idioma: draft.idioma,
        }),
      );
      for (const file of files) {
        formData.append("files", file);
      }

      const response = await fetch("/api/client/agentes/generate-instructions", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        fields?: GeneratedAgentInstructions;
        fileWarnings?: string[];
      };
      if (!response.ok) throw new Error(data.error || "Erro ao gerar instruções.");

      const fields = data.fields;
      if (!fields) throw new Error("Resposta inválida do servidor.");

      const nextDraft: AgentWizardDraft = {
        ...draft,
        instructionMode: "pro",
        promptIdentidade: fields.promptIdentidade,
        promptObjetivo: fields.promptObjetivo,
        systemPrompt: fields.systemPrompt,
        promptRegrasAdicionais: fields.promptRegrasAdicionais,
        respostasProibidas: fields.respostasProibidas,
        simplePrompt: buildSimplePromptFromProFields(fields),
      };

      onApply(nextDraft, data.fileWarnings ?? []);
      setDescription("");
      setFiles([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar instruções.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Gerar prompt com IA"
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={resetAndClose} disabled={loading}>
            Cancelar
          </Button>
          <Button className="w-full sm:w-auto" onClick={() => void handleGenerate()} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Gerando…
              </>
            ) : (
              "Gerar prompt"
            )}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-content-secondary">
        Descreva o negócio e, se quiser, anexe até {WIZARD_PROMPT_MAX_FILES} arquivos (PDF, Office, imagens). Os
        arquivos são usados só nesta geração e não são salvos no sistema.
      </p>

      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        disabled={loading}
        className="mt-3 min-h-[140px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none disabled:opacity-60"
        placeholder="Descreva a operação, o que o agente deve atender, quais informações pode usar, o tom de voz e o que nunca deve prometer sem aprovação..."
      />

      <div className="mt-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={WIZARD_PROMPT_ACCEPT}
          className="sr-only"
          disabled={loading}
          onChange={(e) => addFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full sm:w-auto"
          disabled={loading || files.length >= WIZARD_PROMPT_MAX_FILES}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" aria-hidden />
          Anexar arquivos ({files.length}/{WIZARD_PROMPT_MAX_FILES})
        </Button>
        <p className="mt-2 text-xs text-content-muted">
          PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, JPG, PNG, WEBP — até 10 MB por arquivo.
        </p>
      </div>

      {files.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-elevated/30 px-3 py-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-content">{file.name}</span>
              <span className="shrink-0 text-xs text-content-muted">{formatFileSize(file.size)}</span>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-content-muted hover:bg-surface-elevated hover:text-content"
                aria-label={`Remover ${file.name}`}
                disabled={loading}
                onClick={() => removeFile(index)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
    </Modal>
  );
}
