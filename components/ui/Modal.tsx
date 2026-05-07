"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelAppearancePortalBridge } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Substitui o título simples por um cabeçalho rico (mantém `title` para fallback textual / futuras extensões). */
  titleContent?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, titleContent, children, footer, className }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <PanelAppearancePortalBridge>
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:items-center sm:p-4"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="absolute inset-0 bg-black/65 backdrop-blur-md" aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={cn(
            "panel-modal-surface relative z-[101] mx-auto grid w-full min-h-0 min-w-0 overflow-hidden rounded-2xl border border-line/80 bg-surface-card shadow-elevation-3 sm:rounded-3xl",
            "max-h-[min(calc(100dvh-1rem),calc(100svh-1rem))]",
            footer ? "grid-rows-[auto_minmax(0,1fr)_auto]" : "grid-rows-[auto_minmax(0,1fr)]",
            "p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]",
            className ? className : "max-w-lg",
          )}
        >
          <div className="flex min-h-0 min-w-0 items-start justify-between gap-2 border-b border-line/60 pb-3 sm:gap-3">
            {titleContent ? (
              <div
                id={titleId}
                className="max-h-[min(40svh,300px)] min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 sm:max-h-[min(34vh,340px)] sm:pr-2"
              >
                {titleContent}
              </div>
            ) : (
              <h2
                id={titleId}
                className={cn("min-w-0 flex-1 break-words pr-2", typography.heading.h4)}
              >
                {title}
              </h2>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 !min-h-9 !px-2"
              onClick={onClose}
              aria-label="Fechar modal"
            >
              ✕
            </Button>
          </div>
          <div className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain py-3 pr-1 [scrollbar-gutter:stable] sm:py-4">
            {children}
          </div>
          {footer ? (
            <div className="flex min-h-0 flex-col gap-2 border-t border-line/70 pt-3 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-2 sm:pt-4">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </PanelAppearancePortalBridge>,
    document.body,
  );
}
