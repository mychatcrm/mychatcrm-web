"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  side?: "left" | "right";
}

/**
 * Overlay móvel **sem** `createPortal`: o conteúdo fica na mesma árvore DOM do painel
 * (sob `.panel-app`), evitando perda de contexto/CSS e erros de hidratação.
 */
export function Drawer({ open, onClose, title, children, side = "left" }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] md:hidden" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-md"
        aria-label="Fechar menu"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || "Menu lateral"}
        className={cn(
          "absolute top-0 flex h-full w-[min(100%,320px)] flex-col border-line/80 bg-surface-sidebar",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
        )}
      >
        {title ? (
          <div className={cn("border-b border-line/70 px-4 py-4", typography.label.default)}>{title}</div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
