"use client";

import { AlertCircle, CalendarPlus, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton } from "@/components/panel/ui/PanelButton";
import { cn } from "@/lib/utils";
import { formatClock } from "../meeting-format";
import type { MeetingActionItemRecord } from "@/lib/server/meeting-detail";

const PRIORITY_TONE = { alta: "danger", media: "warning", baixa: "default" } as const;

/**
 * Tarefas extraídas.
 *
 * Cada item mostra o momento que o originou e leva ao trecho no áudio: é a
 * diferença entre "a IA disse que você tem uma tarefa" e "aos 12:04 você disse
 * isto". Sem a prova, ninguém confia o bastante para agir.
 */
export function TabTasks({
  items,
  onSeek,
  onUpdateStatus,
  onApplyToAgenda,
}: {
  items: MeetingActionItemRecord[];
  onSeek: (ms: number) => void;
  onUpdateStatus: (id: string, status: "aberta" | "concluida" | "ignorada") => void;
  onApplyToAgenda?: (ids: string[]) => Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-panel-2xl border border-line/45 bg-surface-card/60 px-4 py-6 text-center text-sm text-content-muted">
        Nenhuma tarefa foi identificada nesta reunião.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "rounded-panel-2xl border border-line/45 bg-surface-card/60 p-3.5",
            item.status !== "aberta" && "opacity-60",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p
              className={cn(
                "text-sm leading-relaxed text-content",
                item.status === "concluida" && "line-through",
              )}
            >
              {item.text}
            </p>
            <Badge variant={PRIORITY_TONE[item.priority]}>{item.priority}</Badge>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-content-muted">
            <button
              type="button"
              onClick={() => onSeek(item.atMs)}
              className="font-mono tabular-nums text-primary hover:underline"
            >
              {formatClock(item.atMs)}
            </button>
            {item.assigneeRaw ? <span>Responsável: {item.assigneeRaw}</span> : null}
            {item.dueDate ? (
              <span className="inline-flex items-center gap-1">
                Prazo: {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("pt-BR")}
                {/*
                  Prazo relativo ("semana que vem") resolvido pela IA fica
                  marcado: quem confirma a data é a pessoa, não o modelo.
                */}
                {item.dueDateInferred ? (
                  <span title="Data deduzida da conversa — confirme antes de usar">
                    <AlertCircle className="h-3 w-3 text-warning" aria-hidden />
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>

          {item.status === "aberta" ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {onApplyToAgenda && item.dueDate && !item.appliedAgendaEventId ? (
                <PanelButton
                  variant="secondary"
                  size="xs"
                  onClick={() => void onApplyToAgenda([item.id])}
                >
                  <CalendarPlus className="h-3 w-3" aria-hidden />
                  Criar na agenda
                </PanelButton>
              ) : null}
              {item.appliedAgendaEventId ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-success">
                  <Check className="h-3 w-3" aria-hidden />
                  Na agenda
                </span>
              ) : null}
              <PanelButton
                variant="outline"
                size="xs"
                onClick={() => onUpdateStatus(item.id, "concluida")}
              >
                <Check className="h-3 w-3" aria-hidden />
                Concluir
              </PanelButton>
              <PanelButton
                variant="ghost"
                size="xs"
                onClick={() => onUpdateStatus(item.id, "ignorada")}
              >
                <X className="h-3 w-3" aria-hidden />
                Não é tarefa
              </PanelButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onUpdateStatus(item.id, "aberta")}
              className="mt-2 text-[11px] text-content-muted hover:text-content hover:underline"
            >
              Reabrir
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
