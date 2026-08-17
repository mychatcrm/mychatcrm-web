"use client";

/**
 * Tela inicial de /dashboard/disparos — cards de campanhas e rascunhos, com
 * estado vazio explícito na primeira visita. Antes disso a tela abria direto
 * no formulário de criação, o que confundia quem só queria ver o que já tinha
 * disparado.
 */
import { Megaphone, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { DisparosDraft } from "@/components/dashboard/disparos/disparos-drafts-storage";

export type DisparosHistoryRow = {
  id: string;
  name: string;
  delivered: number;
  status:
    "draft" | "scheduled" | "processing" | "completed" | "cancelled" | "failed";
  window: string;
};

const STATUS_LABEL: Record<DisparosHistoryRow["status"], string> = {
  completed: "Concluída",
  scheduled: "Agendada",
  processing: "Processando",
  cancelled: "Cancelada",
  failed: "Falhou",
  draft: "Rascunho",
};

type Props = {
  isLight: boolean;
  history: DisparosHistoryRow[];
  drafts: DisparosDraft[];
  processingCampaignId: string | null;
  onCreateNew: () => void;
  onEditDraft: (draft: DisparosDraft) => void;
  onDeleteDraft: (id: string) => void;
  onCancelCampaign: (id: string) => void;
  onProcessNow: (id: string) => void;
};

export function DisparosCampanhasList({
  isLight,
  history,
  drafts,
  processingCampaignId,
  onCreateNew,
  onEditDraft,
  onDeleteDraft,
  onCancelCampaign,
  onProcessNow,
}: Props) {
  const isEmpty = history.length === 0 && drafts.length === 0;

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border p-6 sm:p-8",
          isLight
            ? "border-slate-200/90 bg-surface-deep"
            : "border-line/80 bg-surface-card",
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h3 className="text-balance text-2xl font-semibold tracking-tight text-content sm:text-3xl">
              Disparo em massa
            </h3>
            <p className="max-w-xl text-pretty text-sm leading-relaxed text-content-secondary sm:text-base">
              Resgate clientes antigos ou uma lista importada com uma campanha
              de WhatsApp.
            </p>
          </div>
          <Button
            type="button"
            variant="gradient"
            className="shrink-0 gap-2"
            onClick={onCreateNew}
          >
            <Plus className="size-4" aria-hidden />
            Nova campanha
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <div
          className={cn(
            "flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center",
            isLight
              ? "border-slate-300 bg-surface-deep/60"
              : "border-line bg-surface-deep/20",
          )}
        >
          <Megaphone
            className="size-10 text-content-secondary/60"
            aria-hidden
          />
          <div className="text-sm font-semibold text-content">
            Nenhum disparo criado ainda
          </div>
          <p className="max-w-sm text-xs leading-relaxed text-content-secondary">
            Crie sua primeira campanha pra resgatar clientes antigos, uma lista
            importada ou uma tag do CRM.
          </p>
          <Button
            type="button"
            variant="gradient"
            className="mt-2 gap-2"
            onClick={onCreateNew}
          >
            <Plus className="size-4" aria-hidden />
            Criar disparo
          </Button>
        </div>
      ) : (
        <>
          {drafts.length > 0 ? (
            <div className="space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                Rascunhos ({drafts.length})
              </span>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {drafts.map((d) => {
                  const when = new Date(d.updatedAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  });
                  return (
                    <div
                      key={d.id}
                      className={cn(
                        "flex flex-col gap-3 rounded-xl border p-4",
                        isLight
                          ? "border-slate-200/90 bg-surface-card"
                          : "border-line/80 bg-surface-card/40",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-content">
                          {d.name}
                        </div>
                        <div className="text-[11px] text-content-secondary">
                          Salvo {when}
                        </div>
                      </div>
                      <div className="mt-auto flex items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={() => onEditDraft(d)}
                        >
                          Continuar editando
                        </Button>
                        <button
                          type="button"
                          onClick={() => onDeleteDraft(d.id)}
                          aria-label={`Excluir rascunho ${d.name}`}
                          className={cn(
                            "grid size-9 shrink-0 place-items-center rounded-lg text-content-secondary transition-colors",
                            isLight
                              ? "hover:bg-rose-500/10 hover:text-rose-600"
                              : "hover:bg-rose-500/10 hover:text-rose-300",
                          )}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {history.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                  Campanhas ({history.length})
                </span>
                <Badge className="text-[10px]">Dados persistidos</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {history.map((row) => (
                  <div
                    key={row.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-4",
                      isLight
                        ? "border-slate-200/80 bg-slate-50/80"
                        : "border-line/80 bg-surface-card/40",
                    )}
                  >
                    <div className="relative size-11 shrink-0">
                      <div
                        className="absolute inset-0 rounded-xl"
                        style={{
                          background: `conic-gradient(rgb(34 197 94) ${row.delivered * 3.6}deg, rgba(148,163,184,0.28) 0)`,
                        }}
                        aria-hidden
                      />
                      <div
                        className={cn(
                          "absolute inset-[3px] grid place-items-center rounded-[0.6rem] text-[10px] font-bold tabular-nums",
                          isLight
                            ? "bg-surface-deep text-content"
                            : "bg-slate-950 text-slate-100",
                        )}
                      >
                        {row.delivered}%
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-content">
                        {row.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-content-secondary">
                        <span>{STATUS_LABEL[row.status]}</span>
                        <span className="text-content-secondary/50">·</span>
                        <span>{row.window}</span>
                      </div>
                    </div>
                    {row.status === "processing" ? (
                      <button
                        type="button"
                        onClick={() => onProcessNow(row.id)}
                        disabled={processingCampaignId === row.id}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-content-secondary transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                        aria-label={`Enviar próximo lote agora — ${row.name}`}
                        title="Enviar próximo lote agora"
                      >
                        <RefreshCw
                          className={cn(
                            "size-4",
                            processingCampaignId === row.id && "animate-spin",
                          )}
                          aria-hidden
                        />
                      </button>
                    ) : null}
                    {["draft", "scheduled", "processing"].includes(
                      row.status,
                    ) ? (
                      <button
                        type="button"
                        onClick={() => onCancelCampaign(row.id)}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-content-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                        aria-label={`Cancelar campanha ${row.name}`}
                      >
                        <Square className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
