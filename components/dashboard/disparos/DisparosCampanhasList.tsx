"use client";

/**
 * Tela inicial de /dashboard/disparos — os cards de controle das campanhas.
 *
 * Cada disparo salvo vira um card com play/pause/zerar/editar/excluir e a
 * barra de progresso. Não existe mais "rascunho local": salvar já cria a
 * campanha parada no servidor, e o card É o rascunho até alguém dar play.
 *
 * Os cards são arrastáveis (mesmo padrão de /dashboard/agentes) porque a
 * ordem que importa é a do cliente, não a data de criação.
 */
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Megaphone, Plus } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { cn } from "@/lib/utils";
import { DisparoCard, DisparoDragHandle, type DisparoCardRow } from "@/components/dashboard/disparos/DisparoCard";

export type DisparosHistoryRow = DisparoCardRow;

function SortableDisparoCard({
  row,
  isLight,
  busy,
  onStart,
  onPause,
  onReset,
  onEdit,
  onDelete,
}: {
  row: DisparosHistoryRow;
  isLight: boolean;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("h-full min-w-0", isDragging && "relative z-20")}
    >
      <div
        className={cn(
          "h-full rounded-xl transition-shadow",
          isDragging && "ring-2 ring-primary/25 ring-offset-2 ring-offset-surface-base",
        )}
      >
        <DisparoCard
          row={row}
          isLight={isLight}
          busy={busy}
          dragHandle={
            <DisparoDragHandle
              setActivatorNodeRef={setActivatorNodeRef}
              listeners={listeners}
              attributes={attributes}
              isDragging={isDragging}
            />
          }
          onStart={onStart}
          onPause={onPause}
          onReset={onReset}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

type Props = {
  isLight: boolean;
  history: DisparosHistoryRow[];
  /** Id da campanha com ação em andamento — desabilita os botões só daquele card. */
  busyCampaignId: string | null;
  /** Quantas campanhas agendadas/processando existem agora — mesma contagem que o servidor usa pro teto. */
  activeCampaignCount: number;
  /** Teto de campanhas ativas ao mesmo tempo, igual pra todos os planos. */
  activeCampaignLimit: number;
  onCreateNew: () => void;
  onReorder: (orderedIds: string[]) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onReset: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

export function DisparosCampanhasList({
  isLight,
  history,
  busyCampaignId,
  activeCampaignCount,
  activeCampaignLimit,
  onCreateNew,
  onReorder,
  onStart,
  onPause,
  onReset,
  onEdit,
  onDelete,
}: Props) {
  const atCampaignLimit = activeCampaignCount >= activeCampaignLimit;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = history.findIndex((row) => row.id === active.id);
    const newIndex = history.findIndex((row) => row.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(history, oldIndex, newIndex).map((row) => row.id));
  };

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border p-6 sm:p-8",
          isLight ? "border-slate-200/90 bg-surface-deep" : "border-line/80 bg-surface-card",
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h3 className="text-balance text-2xl font-semibold tracking-tight text-content sm:text-3xl">
              Disparo em massa
            </h3>
            <p className="max-w-xl text-pretty text-sm leading-relaxed text-content-secondary sm:text-base">
              Resgate clientes antigos ou uma lista importada com uma campanha de WhatsApp. Salve agora e dê play
              quando quiser.
            </p>
          </div>
          <Button
            type="button"
            variant="gradient"
            className="shrink-0 gap-2"
            onClick={onCreateNew}
            disabled={atCampaignLimit}
            title={
              atCampaignLimit
                ? `Limite de ${activeCampaignLimit} disparos ativos ao mesmo tempo atingido. Aguarde um terminar ou cancele algum.`
                : undefined
            }
          >
            <Plus className="size-4" aria-hidden />
            Criar disparo
          </Button>
        </div>
      </div>

      {history.length === 0 ? (
        <div
          className={cn(
            "flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center",
            isLight ? "border-slate-300 bg-surface-deep/60" : "border-line bg-surface-deep/20",
          )}
        >
          <Megaphone className="size-10 text-content-secondary/60" aria-hidden />
          <div className="text-sm font-semibold text-content">Nenhum disparo criado ainda</div>
          <p className="max-w-sm text-xs leading-relaxed text-content-secondary">
            Crie seu primeiro disparo pra resgatar clientes antigos, uma lista importada ou uma etapa do CRM. Ele
            aparece aqui como um card, e você dá play quando estiver pronto.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
            Seus disparos ({history.length})
          </span>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={history.map((row) => row.id)} strategy={rectSortingStrategy}>
              <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {history.map((row) => (
                  <SortableDisparoCard
                    key={row.id}
                    row={row}
                    isLight={isLight}
                    busy={busyCampaignId === row.id}
                    onStart={() => onStart(row.id)}
                    onPause={() => onPause(row.id)}
                    onReset={() => onReset(row.id)}
                    onEdit={() => onEdit(row.id)}
                    onDelete={() => onDelete(row.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
