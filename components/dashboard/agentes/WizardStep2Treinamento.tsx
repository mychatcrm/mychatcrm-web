"use client";

import { Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import type { TrainingFileFormat } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AgentWizardDraft } from "@/lib/agents";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

const MAX_MATERIAL_BYTES = 10 * 1024 * 1024;

const ACCEPT_EXTENSIONS =
  ".pdf,.doc,.docx,.xlsx,.pptx,.xml,.md,.markdown,.adoc,.html,.htm,.csv,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.txt";

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

export function WizardStep2Treinamento({
  draft,
  onChange,
  onGeneratePrompt,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
  onGeneratePrompt: () => void;
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
  const [dragActive, setDragActive] = useState(false);
  const [materialError, setMaterialError] = useState("");

  const ingestFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      const oversize = files.filter((f) => f.size > MAX_MATERIAL_BYTES);
      const ok = files.filter((f) => f.size <= MAX_MATERIAL_BYTES);
      if (oversize.length) {
        setMaterialError("Cada arquivo deve ter no máximo 10MB.");
      } else {
        setMaterialError("");
      }
      if (!ok.length) return;
      const nextFiles = ok.map((file) => ({
        id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`,
        nome: file.name,
        tipo: inferTrainingFileFormat(file.name),
        status: "processando" as const,
        tamanhoKb: Math.max(1, Math.round(file.size / 1024)),
      }));
      onChange({ ...draft, arquivosTreinamento: [...draft.arquivosTreinamento, ...nextFiles] });
    },
    [draft, onChange],
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

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <p className="text-sm font-semibold text-content">Identidade</p>
        <p className="mt-1 text-xs text-content-faint">
          Mini prompt: como o agente deve se identificar e se posicionar com o cliente (nome que usa, papel, tom de
          apresentação). Fica antes do objetivo e das instruções longas.
        </p>
        <textarea
          value={draft.promptIdentidade}
          onChange={(event) => onChange({ ...draft, promptIdentidade: event.target.value })}
          placeholder='Ex.: Sou a assistente virtual da empresa X; falo em português claro, no «tu», e deixo explícito que sou um assistente automatizado quando couber.'
          className="mt-3 min-h-[88px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
        />
      </div>

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <p className="text-sm font-semibold text-content">Objetivo</p>
        <p className="mt-1 text-xs text-content-faint">
          Em texto livre: o que este agente deve alcançar (meta comercial, escopo de atendimento, público-alvo). Complementa
          a categoria «Objetivo principal» do passo anterior.
        </p>
        <textarea
          value={draft.promptObjetivo}
          onChange={(event) => onChange({ ...draft, promptObjetivo: event.target.value })}
          placeholder="Ex.: Converter visitantes do WhatsApp em reuniões agendadas com o time comercial, priorizando PMEs de serviços."
          className="mt-3 min-h-[100px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
        />
      </div>

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-content">Instruções</p>
            <p className="mt-1 text-xs text-content-faint">
              Comportamento principal do agente (tom, passos, exemplos). O texto abaixo é editável — pode apagar o modelo
              e colar outro.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <span className="text-xs text-content-faint">Tamanho do prompt (aprox.): {promptSizeUnits} unidades</span>
            <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onGeneratePrompt}>
              Gerar com IA
            </Button>
          </div>
        </div>
        <textarea
          value={draft.systemPrompt}
          onChange={(event) => onChange({ ...draft, systemPrompt: event.target.value })}
          placeholder="Descreva como o agente deve conduzir a conversa, o que priorizar e quando pedir ajuda humana."
          className="mt-3 min-h-[180px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
        />
      </div>

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <p className="text-sm font-semibold text-content">Regras adicionais</p>
        <p className="mt-1 text-xs text-content-faint">
          Opcional: políticas extras, limites de promessa, formato de respostas, ou o que não couber em «Respostas
          proibidas».
        </p>
        <textarea
          value={draft.promptRegrasAdicionais}
          onChange={(event) => onChange({ ...draft, promptRegrasAdicionais: event.target.value })}
          placeholder="Ex.: Sempre confirmar cidade e segmento antes de enviar preço. Usar listas curtas com no máximo 3 itens."
          className="mt-3 min-h-[100px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
        />
      </div>

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <p className="text-sm font-semibold text-content">Respostas proibidas</p>
        <p className="mt-1 text-xs text-content-faint">
          Liste o que o agente não deve dizer ou prometer (concorrentes, descontos, garantias legais, etc.).
        </p>
        <textarea
          value={draft.respostasProibidas}
          onChange={(event) => onChange({ ...draft, respostasProibidas: event.target.value })}
          placeholder="Não mencione concorrentes, não dê descontos acima de 5%..."
          className="mt-3 min-h-[110px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
        />
      </div>

      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-content">Temperatura</p>
            <p className="mt-1 text-xs text-content-muted">Menor = mais diretas | Maior = mais criativo</p>
          </div>
          <span className="w-fit shrink-0 rounded-full border border-line bg-surface-elevated px-3 py-1 text-sm font-semibold tabular-nums text-content">
            {Number(temperaturaClamped.toFixed(2))}
          </span>
        </div>
        <div className="mt-5 px-0.5">
          <div className="relative flex h-10 items-center">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-line" />
            <div
              className="pointer-events-none absolute left-0 top-1/2 h-2 max-w-full -translate-y-1/2 rounded-l-full bg-primary transition-[width] duration-75 ease-out"
              style={{ width: `${temperaturaPct}%` }}
            />
            <div
              className={cn("pointer-events-none absolute top-1/2 z-[1] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-[left] duration-75 ease-out", isLight ? "border-line bg-white" : "border-white/20 bg-surface-elevated")}
              style={{ left: `${temperaturaPct}%` }}
            />
            <input
              type="range"
              min={TEMP_MIN}
              max={TEMP_MAX}
              step={0.01}
              value={temperaturaClamped}
              aria-label="Temperatura do modelo"
              onChange={(event) => {
                const v = Number(event.target.value);
                onChange({ ...draft, temperatura: Math.min(TEMP_MAX, Math.max(TEMP_MIN, v)) });
              }}
              className="absolute inset-0 z-[2] w-full cursor-pointer opacity-0"
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] tabular-nums text-content-muted">
            <span>{TEMP_MIN}</span>
            <span>{TEMP_MAX}</span>
          </div>
        </div>
      </div>

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
            ingestFiles(event.target.files);
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
            ingestFiles(event.dataTransfer.files);
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
            Formatos aceitos: PDF, DOCX, XLSX, PPTX, XML, Markdown, AsciiDoc, HTML, CSV, PNG, JPEG, TIFF, BMP até 10MB
          </p>
        </button>

        {materialError ? <p className="mt-2 text-xs text-rose-300">{materialError}</p> : null}

        {draft.arquivosTreinamento.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {draft.arquivosTreinamento.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-elevated/35 px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate text-content-secondary">{file.nome}</span>
                <span className="shrink-0 capitalize text-content-faint">{file.status}</span>
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
