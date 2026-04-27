/**
 * PanelInput — versão DS do Input exclusiva para /dashboard e /admin.
 *
 * API idêntica ao components/ui/Input.tsx, mas com:
 *  - bg-surface-base (cinza #F2F2F2 no claro, preto #000 no escuro)
 *  - py-3.5 (padding generoso DS)
 *  - focus:bg-surface-deep (branco no claro, #0a0a0a no escuro)
 *  - rounded-panel-xl (radius DS 0.45rem)
 *
 * NUNCA importar fora de components/dashboard/**, components/admin/**, components/panel/**.
 */
import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { PANEL_INPUT_BASE } from "@/lib/panel-component-tokens";

export const PanelInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PanelInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(PANEL_INPUT_BASE, className)}
        {...props}
      />
    );
  },
);
