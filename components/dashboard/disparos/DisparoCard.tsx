"use client";

/**
 * Card de uma campanha na tela de Disparos.
 *
 * É o painel de controle do disparo: mostra o quanto já andou e concentra as
 * cinco ações — play, pause, começar do zero, editar e excluir. O botão
 * principal é contextual (play vira pause enquanto está enviando), porque em
 * qualquer momento só uma dessas duas coisas faz sentido.
 *
 * "Começar do zero" e "Excluir" pedem confirmação inline no próprio card: são
 * as duas que destroem trabalho, e um clique errado num grid de cards é fácil
 * demais.
 */
import { useState } from "react";
import { GripVertical, Pause, Pencil, Play, Square, Trash2 } from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type DisparoCardStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "paused"
  | "review_required"
  | "completed"
  | "cancelled"
  | "failed";

export type DisparoCardRow = {
  id: string;
  name: string;
  status: DisparoCardStatus;
  totalRecipients: number;
  totalSent: number;
  totalFailed: number;
  scheduledLabel: string;
};

const STATUS_META: Record<
  DisparoCardStatus,
  { label: string; dot: string; text: string; chip: string }
> = {
  draft: {
    label: "Pronto pra enviar",
    dot: "bg-slate-400",
    text: "text-content-secondary",
    chip: "bg-surface-elevated/60",
  },
  scheduled: {
    label: "Na fila",
    dot: "bg-sky-400",
    text: "text-sky-500 dark:text-sky-300",
    chip: "bg-sky-500/10",
  },
  processing: {
    label: "Enviando",
    dot: "bg-emerald-400 animate-pulse",
    text: "text-emerald-600 dark:text-emerald-300",
    chip: "bg-emerald-500/10",
  },
  paused: {
    label: "Pausado",
    dot: "bg-amber-400",
    text: "text-amber-600 dark:text-amber-300",
    chip: "bg-amber-500/10",
  },
  review_required: {
    label: "Ação necessária",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-300",
    chip: "bg-amber-500/10",
  },
  completed: {
    label: "Concluído",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-300",
    chip: "bg-emerald-500/10",
  },
  cancelled: {
    label: "Cancelado",
    dot: "bg-slate-400",
    text: "text-content-secondary",
    chip: "bg-surface-elevated/60",
  },
  failed: {
    label: "Falhou",
    dot: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-300",
    chip: "bg-rose-500/10",
  },
};

function IconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "neutral",
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg text-content-secondary transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-35",
        tone === "danger"
          ? "hover:bg-rose-500/10 hover:text-rose-500"
          : "hover:bg-primary/10 hover:text-primary",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/**
 * Tecla de aparelho de som: quadrada, com relevo, e afundando ao apertar.
 *
 * O relevo vem de um `box-shadow` interno claro em cima e escuro embaixo
 * (luz vindo de cima) — no estado apertado a ordem inverte e a tecla parece
 * afundar no painel. Um `translate-y` de 1px no `:active` completa o gesto.
 */
function TransportKey({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  accent = "neutral",
  filled,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Tecla travada apertada — o play fica assim enquanto o disparo corre. */
  active?: boolean;
  accent?: "neutral" | "play" | "pause" | "stop";
  filled?: boolean;
}) {
  const accentColor =
    accent === "play"
      ? "text-emerald-500 dark:text-emerald-400"
      : accent === "pause"
        ? "text-amber-500 dark:text-amber-400"
        : accent === "stop"
          ? "text-rose-500 dark:text-rose-400"
          : "text-content-secondary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "group/key relative grid h-10 flex-1 place-items-center rounded-[5px] border transition-all duration-75",
        "border-black/25 bg-gradient-to-b from-surface-elevated/95 to-surface-elevated/60",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-2px_3px_rgba(0,0,0,0.3),0_1px_2px_rgba(0,0,0,0.35)]",
        "hover:from-surface-elevated hover:to-surface-elevated/75",
        "active:translate-y-[1px] active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.45)]",
        active &&
          "translate-y-[1px] from-surface-deep to-surface-deep shadow-[inset_0_2px_5px_rgba(0,0,0,0.5)]",
        "disabled:cursor-not-allowed disabled:opacity-30 disabled:active:translate-y-0",
        "disabled:active:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-2px_3px_rgba(0,0,0,0.3),0_1px_2px_rgba(0,0,0,0.35)]",
      )}
    >
      <Icon
        className={cn("size-[15px] transition-colors", accentColor)}
        fill={filled ? "currentColor" : "none"}
        strokeWidth={filled ? 0 : 2}
        aria-hidden
      />
      {/* LED de estado, como o pontinho vermelho dos aparelhos antigos. */}
      <span
        className={cn(
          "absolute bottom-1 size-1 rounded-full transition-opacity",
          active ? "bg-emerald-400 opacity-100 shadow-[0_0_4px_rgba(52,211,153,0.9)]" : "opacity-0",
        )}
        aria-hidden
      />
    </button>
  );
}

export function DisparoCard({
  row,
  isLight,
  busy,
  dragHandle,
  onStart,
  onPause,
  onReset,
  onEdit,
  onDelete,
}: {
  row: DisparoCardRow;
  isLight: boolean;
  busy: boolean;
  dragHandle?: ReactNode;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState<"reset" | "delete" | null>(null);

  const meta = STATUS_META[row.status];
  const total = Math.max(0, row.totalRecipients);
  const done = Math.min(total, row.totalSent + row.totalFailed);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const restante = Math.max(0, total - done);

  const isRunning = row.status === "scheduled" || row.status === "processing";
  const canStart = row.status === "draft" || row.status === "paused";
  // Editar só enquanto nada saiu: por baixo, salvar a edição recria a
  // campanha, e recriar uma fila que já mandou mensagem faria quem já recebeu
  // receber de novo.
  const canEdit = !isRunning && done === 0;
  const canReset = done > 0 || row.status !== "draft";

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl border p-4 transition-shadow",
        isLight
          ? "border-slate-200/90 bg-surface-card shadow-sm hover:shadow-md"
          : "border-line/80 bg-surface-card/40 hover:border-line",
      )}
    >
      {/* Faixa de progresso no topo do card — leitura periférica, sem ocupar espaço. */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-surface-elevated/40" aria-hidden>
        <div
          className={cn(
            "h-full transition-[width] duration-500",
            row.status === "failed" ? "bg-rose-500" : "bg-gradient-to-r from-primary/70 to-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="flex items-start gap-2">
        {dragHandle}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-content">{row.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                meta.chip,
                meta.text,
              )}
            >
              <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
              {meta.label}
            </span>
            <span className="text-[11px] text-content-secondary">{row.scheduledLabel}</span>
          </div>
        </div>
        <span className="shrink-0 text-lg font-bold tabular-nums text-content">{percent}%</span>
      </div>

      <div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-elevated/50">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              row.status === "failed" ? "bg-rose-500" : "bg-gradient-to-r from-primary/70 to-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-content-secondary">
          <span>
            <strong className="text-content">{row.totalSent.toLocaleString("pt-BR")}</strong> enviados
          </span>
          <span className="text-content-secondary/40">·</span>
          <span>{restante.toLocaleString("pt-BR")} restantes</span>
          {row.totalFailed > 0 ? (
            <>
              <span className="text-content-secondary/40">·</span>
              <span className="text-rose-500">{row.totalFailed.toLocaleString("pt-BR")} falharam</span>
            </>
          ) : null}
        </div>
      </div>

      {confirming ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5",
            confirming === "delete"
              ? "border-rose-500/40 bg-rose-500/10"
              : "border-amber-500/40 bg-amber-500/10",
          )}
        >
          <p className="text-[11px] leading-relaxed text-content">
            {confirming === "delete"
              ? "Excluir este disparo de vez? Não dá pra desfazer."
              : "Voltar do zero? Todo mundo entra na fila de novo — inclusive quem já recebeu."}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (confirming === "delete") onDelete();
                else onReset();
                setConfirming(null);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition-colors",
                confirming === "delete" ? "bg-rose-500 hover:bg-rose-600" : "bg-amber-500 hover:bg-amber-600",
              )}
            >
              {confirming === "delete" ? "Excluir" : "Começar do zero"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-content-secondary transition-colors hover:text-content"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-auto space-y-2">
          {/* Botoeira de aparelho de som: painel afundado com as três teclas. */}
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-lg border p-1.5",
              isLight
                ? "border-slate-300/80 bg-slate-100/80 shadow-[inset_0_2px_4px_rgba(0,0,0,0.10)]"
                : "border-black/35 bg-black/25 shadow-[inset_0_2px_5px_rgba(0,0,0,0.45)]",
            )}
          >
            <TransportKey
              icon={Play}
              label={
                canStart
                  ? row.status === "paused"
                    ? "Retomar de onde parou"
                    : "Iniciar disparo"
                  : "Já terminou — use STOP pra rodar de novo"
              }
              onClick={onStart}
              disabled={busy || !canStart}
              active={isRunning}
              accent="play"
              filled
            />
            <TransportKey
              icon={Pause}
              label="Pausar"
              onClick={onPause}
              disabled={busy || !isRunning}
              active={row.status === "paused"}
              accent="pause"
              filled
            />
            <TransportKey
              icon={Square}
              label="Começar do zero"
              onClick={() => setConfirming("reset")}
              disabled={busy || !canReset}
              accent="stop"
              filled
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-content-secondary/70">
              {isRunning ? "Rodando" : row.status === "paused" ? "Em pausa" : "Parado"}
            </span>
            <div className="flex items-center gap-0.5">
              <IconAction
                icon={Pencil}
                label={canEdit ? "Editar" : "Só dá pra editar antes do primeiro envio"}
                onClick={onEdit}
                disabled={busy || !canEdit}
              />
              <IconAction
                icon={Trash2}
                label="Excluir"
                onClick={() => setConfirming("delete")}
                disabled={busy}
                tone="danger"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Alça de arrastar, no mesmo padrão dos cards de agente. */
export function DisparoDragHandle({
  setActivatorNodeRef,
  listeners,
  attributes,
  isDragging,
}: {
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  // Vêm do `useSortable` do dnd-kit e são repassados inteiros pro botão.
  listeners?: SyntheticListenerMap;
  attributes?: DraggableAttributes;
  isDragging: boolean;
}) {
  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className={cn(
        "-ml-1 grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-content-muted transition",
        "hover:bg-surface-elevated/55 hover:text-content-secondary active:cursor-grabbing",
        isDragging && "bg-primary/10 text-primary",
      )}
      aria-label="Arrastar para reordenar os disparos"
      {...listeners}
      {...attributes}
    >
      <GripVertical className="size-4" strokeWidth={2} aria-hidden />
    </button>
  );
}
