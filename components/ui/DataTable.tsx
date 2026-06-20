import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  emptyLabel?: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  data,
  emptyLabel = "Nenhum registro encontrado.",
  rowKey,
  onRowClick,
}: DataTableProps<T>) {
  if (!data.length) {
    return (
      <div className="panel-surface-card rounded-xl border border-dashed border-line/70 bg-surface-deep/60 p-10 text-center text-sm text-content-muted">
        <div className="mx-auto mb-3 h-1 w-16 rounded-full bg-primary/70" aria-hidden />
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="panel-data-table min-w-0 overflow-hidden rounded-xl border border-line/80 bg-surface-card">
      <div className="min-w-0 overflow-x-auto [-webkit-overflow-scrolling:touch] touch-pan-x">
        <table className="min-w-full divide-y divide-line/60 text-left text-sm">
          <thead className="bg-surface-elevated/60">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  "transition-colors odd:bg-surface-deep/[0.015]",
                  onRowClick && "cursor-pointer hover:bg-primary/[0.045]",
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("whitespace-nowrap px-4 py-3.5 text-[13px] text-content-secondary", c.className)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
