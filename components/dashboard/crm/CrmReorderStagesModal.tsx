"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CrmFunnelColumn } from "@/lib/crm-funnels";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

function SortableStageRow({ id, title }: { id: string; title: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-line bg-surface-deep/30 px-3 py-2.5",
        isDragging && "z-10 border-primary/40 bg-primary/5 opacity-95 ring-2 ring-primary/20",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-lg border border-line/80",
          "text-content-muted hover:bg-surface-elevated/40 hover:text-content active:cursor-grabbing",
        )}
        aria-label={`Arrastar etapa ${title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" strokeWidth={2} aria-hidden />
      </button>
      <span className="min-w-0 flex-1 text-sm font-medium text-content">{title}</span>
    </div>
  );
}

export function CrmReorderStagesModal({
  open,
  onClose,
  columns,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columns: CrmFunnelColumn[];
  onApply: (next: CrmFunnelColumn[]) => void;
}) {
  const [items, setItems] = useState<CrmFunnelColumn[]>(columns);

  useEffect(() => {
    if (open) setItems(columns.map((c) => ({ ...c })));
  }, [open, columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((c) => c.id === active.id);
    const newIndex = items.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setItems((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const handleApply = () => {
    onApply(items.map((c) => ({ ...c })));
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ordenar etapas do funil"
      className="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleApply}>
            Guardar ordem
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-content-muted">
          Arraste pelo ícone de pegar para mudar a ordem das colunas no CRM Kanban. A ordem guardada aplica-se de imediato ao
          quadro.
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2" role="list">
              {items.map((col) => (
                <li key={col.id}>
                  <SortableStageRow id={col.id} title={col.title} />
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
    </Modal>
  );
}
