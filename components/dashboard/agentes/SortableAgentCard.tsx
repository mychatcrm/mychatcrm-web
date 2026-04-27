"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";

export function SortableAgentCard({
  agent,
  onToggleStatus,
  onDuplicate,
  onManage,
}: {
  agent: Agent;
  onToggleStatus: (agentId: string) => void;
  onDuplicate: (agentId: string) => void;
  onManage: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: agent.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className={cn(
        "flex h-9 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border border-transparent text-content-muted transition",
        "hover:border-line hover:bg-surface-elevated/50 hover:text-content-secondary",
        "active:cursor-grabbing",
        isDragging && "border-primary/30 bg-primary/10 text-primary",
      )}
      aria-label="Arrastar para reordenar os agentes"
      {...listeners}
      {...attributes}
    >
      <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("h-full min-h-0", isDragging && "relative z-20")}
    >
      <div
        className={cn(
          "h-full rounded-xl transition-colors",
          isDragging && "ring-2 ring-primary/25 ring-offset-2 ring-offset-surface-base",
        )}
      >
        <AgentCard
          agent={agent}
          onToggleStatus={onToggleStatus}
          onDuplicate={onDuplicate}
          dragHandle={dragHandle}
          onManage={onManage}
        />
      </div>
    </div>
  );
}
