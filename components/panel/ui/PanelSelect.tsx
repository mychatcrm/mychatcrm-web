/**
 * PanelSelect — versão DS do Select exclusiva para /dashboard e /admin.
 *
 * Select nativo estilizado com tokens do painel DS (`/dashboard`, `/admin`).
 *
 * NUNCA importar fora de components/dashboard/**, components/admin/**, components/panel/**.
 */
import type { SelectHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const PanelSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function PanelSelect({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "w-full rounded-xl border border-line/45 [background-color:var(--panel-section-fill)] px-4 py-3.5 pr-9 text-sm font-normal text-content transition-all duration-150 appearance-none shadow-none",
          "bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%20fill%3D%22none%22%3E%3Cpath%20d%3D%22M3%204.5L6%207.5L9%204.5%22%20stroke%3D%22%23888%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat [background-position:calc(100%-0.75rem)_center] [background-size:12px_12px]",
          "hover:border-line/70 hover:bg-surface-elevated/50",
          "focus:border-primary/55 focus:bg-surface-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
